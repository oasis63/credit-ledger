import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { todayIso } from '../domain/ledger.js';
import { formatRupees, rupeesToPaise } from '../domain/money.js';
import { ENTRY_COLUMNS } from '../services/customers.js';

const amount = z.union([z.number().positive(), z.string()]).transform((v, ctx) => {
  try {
    const p = rupeesToPaise(v);
    if (p <= 0) throw new Error('Amount must be more than zero');
    return p;
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    return z.NEVER;
  }
});

const collectionBody = z
  .object({
    customer_id: z.string().uuid(),
    amount,
    payment_mode: z.enum(['cash', 'cheque', 'upi', 'bank']),
    payment_ref: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.payment_mode === 'cheque' || v.payment_mode === 'upi') && !v.payment_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_ref'],
        message: v.payment_mode === 'cheque' ? 'Cheque number is required' : 'UPI reference (UTR) is required',
      });
    }
  });

const MODE_TEXT = { cash: 'Cash', cheque: 'Cheque', upi: 'UPI', bank: 'Bank transfer' } as const;

export async function collectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const now = () => app.deps.now?.() ?? new Date();

  /**
   * A salesman (or anyone) records money collected in the field. The retailer
   * gets an instant WhatsApp receipt: the retailer becomes the auditor, which
   * is what stops collected cash from going missing.
   */
  app.post('/', async (req, reply) => {
    const body = collectionBody.parse(req.body);
    const result = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const c = await tx.query<{ name: string; phone: string; language: 'en' | 'hi' }>(
        'SELECT name, phone, language FROM customers WHERE id = $1',
        [body.customer_id],
      );
      if (!c.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      const tenant = await tx.query<{ name: string }>('SELECT name FROM tenants');
      const res = await tx.query(
        `INSERT INTO ledger_entries
           (tenant_id, customer_id, kind, amount_paise, entry_date, payment_mode, payment_ref, note, collected_by, created_by)
         VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7, $8, $8) RETURNING ${ENTRY_COLUMNS}`,
        [req.user.tid, body.customer_id, body.amount, todayIso(now()), body.payment_mode, body.payment_ref ?? null, body.note ?? null, req.user.sub],
      );
      const entry = res.rows[0];
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'collection.recorded', entry.id, {
        customer_id: body.customer_id,
        amount_paise: body.amount,
        mode: body.payment_mode,
      });
      return { entry, customer: c.rows[0], businessName: tenant.rows[0]!.name };
    });

    const receiptNo = String(result.entry.id).slice(0, 8).toUpperCase();
    const sent = await app.deps.sender.sendReceipt({
      to: result.customer.phone,
      customerName: result.customer.name,
      businessName: result.businessName,
      amountText: formatRupees(body.amount),
      modeText: MODE_TEXT[body.payment_mode],
      collectedBy: req.user.name,
      receiptNo,
      language: result.customer.language,
    });
    if (!sent.ok) req.log.warn({ err: sent.error, entry: result.entry.id }, 'receipt message failed');
    return reply.status(201).send({ entry: result.entry, receipt: { number: receiptNo, sent: sent.ok, error: sent.error ?? null } });
  });

  /** Cash and cheques collected but not yet handed over to the office. */
  app.get('/pending', async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const params: unknown[] = [];
      let filter = '';
      if (req.user.role === 'salesman') filter = `AND e.collected_by = $${params.push(req.user.sub)}`;
      const res = await tx.query(
        `SELECT e.collected_by AS salesman_id, u.name AS salesman_name,
                count(*)::int AS entry_count, sum(e.amount_paise)::bigint AS total_paise,
                sum(CASE WHEN e.payment_mode = 'cash' THEN e.amount_paise ELSE 0 END)::bigint AS cash_paise,
                sum(CASE WHEN e.payment_mode = 'cheque' THEN e.amount_paise ELSE 0 END)::bigint AS cheque_paise
         FROM ledger_entries e JOIN users u ON u.id = e.collected_by
         WHERE e.kind = 'payment' AND e.payment_mode IN ('cash', 'cheque') AND e.handed_over_at IS NULL ${filter}
         GROUP BY e.collected_by, u.name ORDER BY u.name`,
        params,
      );
      return { pending: res.rows };
    });
  });

  /** Office closes a salesman's day: declared cash vs what the app recorded. */
  app.post('/day-close', { preHandler: app.requireRole('owner', 'accountant') }, async (req, reply) => {
    const body = z
      .object({
        salesman_id: z.string().uuid(),
        declared: z.union([z.number().nonnegative(), z.string()]).transform((v) => rupeesToPaise(v)),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    const close = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const pending = await tx.query<{ id: string; amount_paise: number }>(
        `SELECT id, amount_paise FROM ledger_entries
         WHERE kind = 'payment' AND payment_mode IN ('cash', 'cheque') AND handed_over_at IS NULL AND collected_by = $1
         FOR UPDATE`,
        [body.salesman_id],
      );
      if (pending.rows.length === 0) throw new HttpError(400, 'Nothing pending for this salesman', 'nothing_pending');
      const expected = pending.rows.reduce((s, r) => s + r.amount_paise, 0);
      await tx.query('UPDATE ledger_entries SET handed_over_at = now() WHERE id = ANY($1)', [pending.rows.map((r) => r.id)]);
      const res = await tx.query(
        `INSERT INTO day_closes (tenant_id, salesman_id, expected_paise, declared_paise, variance_paise, entry_count, note, closed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.tid, body.salesman_id, expected, body.declared, body.declared - expected, pending.rows.length, body.note ?? null, req.user.sub],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'collection.day_closed', res.rows[0].id, {
        expected_paise: expected,
        declared_paise: body.declared,
      });
      return res.rows[0];
    });
    return reply.status(201).send({ day_close: close });
  });

  app.get('/day-closes', { preHandler: app.requireRole('owner', 'accountant') }, async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `SELECT d.*, u.name AS salesman_name FROM day_closes d JOIN users u ON u.id = d.salesman_id
         ORDER BY d.created_at DESC LIMIT 100`,
      );
      return { day_closes: res.rows };
    });
  });
}
