import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, withSystem, withTenant } from '../db.js';
import { todayIso } from '../domain/ledger.js';
import { parsePromise } from '../domain/promiseParser.js';
import { extractInboundTexts, normalisePhone, verifyWebhookSignature } from '../services/whatsapp.js';

/**
 * WhatsApp Cloud API webhook. Retailer replies like "kal payment kar dunga"
 * become payment promises with a date, which are later marked kept or broken.
 */
export async function webhookRoutes(app: FastifyInstance) {
  const { config } = app.deps;
  const now = () => app.deps.now?.() ?? new Date();

  app.get('/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (config.WHATSAPP_VERIFY_TOKEN && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send({ error: 'forbidden' });
  });

  app.post('/whatsapp', async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (config.WHATSAPP_APP_SECRET) {
      if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, config.WHATSAPP_APP_SECRET)) {
        return reply.status(401).send({ error: 'bad_signature' });
      }
    } else if (config.NODE_ENV === 'production') {
      req.log.error('WHATSAPP_APP_SECRET is not set; refusing unsigned webhook in production');
      return reply.status(503).send({ error: 'webhook_not_configured' });
    }

    const asOf = todayIso(now());
    for (const msg of extractInboundTexts(req.body)) {
      const parsed = parsePromise(msg.text, asOf);
      if (!parsed) continue;
      const phone = normalisePhone(msg.from);
      if (!phone) continue;
      const tenant = await withSystem(app.deps.db, async (tx) => {
        const r = await tx.query<{ id: string }>('SELECT id FROM tenants WHERE wa_phone_number_id = $1', [msg.phoneNumberId]);
        return r.rows[0]?.id;
      });
      if (!tenant) continue;
      await withTenant(app.deps.db, tenant, async (tx) => {
        const c = await tx.query<{ id: string }>('SELECT id FROM customers WHERE phone = $1', [phone]);
        const customerId = c.rows[0]?.id;
        if (!customerId) return;
        const res = await tx.query(
          `INSERT INTO promises (tenant_id, customer_id, promised_date, amount_paise, source_text)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenant, customerId, parsed.promised_date, parsed.amount_paise, msg.text.slice(0, 1000)],
        );
        await audit(tx, tenant, `retailer:${customerId}`, 'promise.recorded', res.rows[0].id, { matched: parsed.matched });
      });
    }
    // Always 200 so Meta does not retry messages we chose to ignore.
    return reply.status(200).send({ ok: true });
  });
}
