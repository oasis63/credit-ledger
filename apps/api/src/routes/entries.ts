import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { addDays, todayIso } from '../domain/ledger.js';
import { rupeesToPaise } from '../domain/money.js';
import { ENTRY_COLUMNS } from '../services/customers.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

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

const entryBody = z
  .object({
    kind: z.enum(['opening_balance', 'invoice', 'payment', 'credit_note', 'adjustment_debit', 'adjustment_credit', 'cheque_bounce']),
    amount,
    entry_date: isoDate.optional(),
    due_date: isoDate.nullable().optional(),
    reference: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
    payment_mode: z.enum(['cash', 'cheque', 'upi', 'bank']).optional(),
    payment_ref: z.string().trim().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'payment' && !v.payment_mode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payment_mode'], message: 'Payment mode is required' });
    }
    if (v.kind !== 'payment' && v.payment_mode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payment_mode'], message: 'Only payments have a mode' });
    }
    if ((v.kind === 'adjustment_debit' || v.kind === 'adjustment_credit') && !v.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Adjustments need a reason' });
    }
  });

export async function entryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const now = () => app.deps.now?.() ?? new Date();

  /** Post a ledger entry. Office staff only; salesmen record collections via /api/collections. */
  app.post('/customers/:id/entries', { preHandler: app.requireRole('owner', 'accountant') }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = entryBody.parse(req.body);
    const entryDate = body.entry_date ?? todayIso(now());
    const entry = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const c = await tx.query<{ credit_days: number }>('SELECT credit_days FROM customers WHERE id = $1', [id]);
      if (!c.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      let due: string | null = null;
      if (body.kind === 'invoice') due = body.due_date ?? addDays(entryDate, c.rows[0].credit_days);
      else if (body.kind === 'opening_balance' || body.kind === 'cheque_bounce' || body.kind === 'adjustment_debit') {
        due = body.due_date ?? entryDate;
      }
      const res = await tx.query(
        `INSERT INTO ledger_entries
           (tenant_id, customer_id, kind, amount_paise, entry_date, due_date, reference, note, payment_mode, payment_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${ENTRY_COLUMNS}`,
        [
          req.user.tid, id, body.kind, body.amount, entryDate, due, body.reference ?? null, body.note ?? null,
          body.payment_mode ?? null, body.payment_ref ?? null, req.user.sub,
        ],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, `entry.${body.kind}`, res.rows[0].id, {
        customer_id: id,
        amount_paise: body.amount,
      });
      return res.rows[0];
    });
    return reply.status(201).send({ entry });
  });

  app.get('/entries', async (req) => {
    const q = z
      .object({
        customer_id: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.customer_id) where.push(`customer_id = $${params.push(q.customer_id)}`);
      if (q.from) where.push(`entry_date >= $${params.push(q.from)}`);
      if (q.to) where.push(`entry_date <= $${params.push(q.to)}`);
      // Salesmen only see what they collected.
      if (req.user.role === 'salesman') where.push(`collected_by = $${params.push(req.user.sub)}`);
      const res = await tx.query(
        `SELECT ${ENTRY_COLUMNS} FROM ledger_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY entry_date DESC, created_at DESC LIMIT $${params.push(q.limit)}`,
        params,
      );
      return { entries: res.rows };
    });
  });
}
