import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { todayIso } from '../domain/ledger.js';
import { formatRupees } from '../domain/money.js';
import { customerSummaries } from '../services/customers.js';
import { statementUrl } from './customers.js';

const COOLDOWN_HOURS = 72;

interface Target {
  id: string;
  name: string;
  phone: string;
  language: 'en' | 'hi';
  amount_paise: number;
}

export async function reminderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const staff = { preHandler: app.requireRole('owner', 'accountant') };
  const now = () => app.deps.now?.() ?? new Date();

  /**
   * Send one reminder, then record it in its own short transaction. Network
   * calls never run inside a database transaction, so a slow or failing
   * WhatsApp API cannot hold locks or roll back records of messages already sent.
   */
  async function remind(tenantId: string, userId: string, businessName: string, t: Target) {
    const { config, sender } = app.deps;
    const url = statementUrl(config.PUBLIC_WEB_URL, tenantId, t.id, config.STATEMENT_LINK_SECRET, config.STATEMENT_LINK_TTL_DAYS, now());
    const result = await sender.sendReminder({
      to: t.phone,
      customerName: t.name,
      businessName,
      amountText: formatRupees(t.amount_paise),
      statementUrl: url,
      language: t.language,
    });
    return withTenant(app.deps.db, tenantId, async (tx) => {
      const row = await tx.query(
        `INSERT INTO reminders (tenant_id, customer_id, channel, amount_paise, status, provider_message_id, error, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenantId, t.id, sender.channel, t.amount_paise, result.ok ? 'sent' : 'failed', result.providerMessageId ?? null, result.error ?? null, userId],
      );
      await audit(tx, tenantId, `user:${userId}`, 'reminder.sent', row.rows[0].id, { ok: result.ok });
      return row.rows[0];
    });
  }

  /** Remind one customer for their overdue amount (or the full balance if nothing is overdue yet). */
  app.post('/customers/:id', staff, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { target, businessName } = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const summary = (await customerSummaries(tx, todayIso(now()))).find((c) => c.id === id);
      if (!summary) throw new HttpError(404, 'Customer not found', 'not_found');
      const amount = summary.overdue_paise > 0 ? summary.overdue_paise : summary.balance_paise;
      if (amount <= 0) throw new HttpError(400, 'This customer owes nothing', 'nothing_due');
      const tenant = await tx.query<{ name: string }>('SELECT name FROM tenants');
      return { target: { ...summary, amount_paise: amount }, businessName: tenant.rows[0]!.name };
    });
    const reminder = await remind(req.user.tid, req.user.sub, businessName, target);
    return reply.status(reminder.status === 'sent' ? 201 : 502).send({ reminder });
  });

  /** Remind every overdue customer not reminded within the cooldown window. */
  app.post('/bulk', staff, async (req) => {
    const body = z.object({ min_days_overdue: z.number().int().min(1).max(365).default(1) }).parse(req.body ?? {});
    const plan = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const summaries = await customerSummaries(tx, todayIso(now()));
      const recent = await tx.query<{ customer_id: string }>(
        `SELECT DISTINCT customer_id FROM reminders WHERE status = 'sent' AND created_at > now() - make_interval(hours => $1)`,
        [COOLDOWN_HOURS],
      );
      const skip = new Set(recent.rows.map((r) => r.customer_id));
      const tenant = await tx.query<{ name: string }>('SELECT name FROM tenants');
      const overdue = summaries.filter((c) => c.overdue_paise > 0);
      return {
        businessName: tenant.rows[0]!.name,
        targets: overdue
          .filter((c) => c.risk.max_days_overdue >= body.min_days_overdue && !skip.has(c.id))
          .map((c) => ({ ...c, amount_paise: c.overdue_paise })),
        skipped: overdue.filter((c) => skip.has(c.id)).length,
      };
    });
    let sent = 0;
    let failed = 0;
    for (const t of plan.targets) {
      const r = await remind(req.user.tid, req.user.sub, plan.businessName, t);
      if (r.status === 'sent') sent++;
      else failed++;
    }
    return { sent, failed, skipped_recently_reminded: plan.skipped };
  });

  app.get('/', async (req) => {
    const q = z.object({ customer_id: z.string().uuid().optional() }).parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `SELECT r.*, c.name AS customer_name FROM reminders r JOIN customers c ON c.id = r.customer_id
         ${q.customer_id ? 'WHERE r.customer_id = $1' : ''} ORDER BY r.created_at DESC LIMIT 200`,
        q.customer_id ? [q.customer_id] : [],
      );
      return { reminders: res.rows };
    });
  });
}
