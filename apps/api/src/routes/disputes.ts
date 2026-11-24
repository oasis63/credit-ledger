import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';

export const DISPUTE_REASONS = ['amount_wrong', 'return_not_applied', 'scheme_discount', 'already_paid', 'not_received', 'other'] as const;

export async function disputeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const staff = { preHandler: app.requireRole('owner', 'accountant') };

  app.get('/', async (req) => {
    const q = z.object({ status: z.enum(['open', 'resolved', 'rejected', 'all']).default('open') }).parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `SELECT d.*, c.name AS customer_name, e.reference AS entry_reference, e.amount_paise AS entry_amount_paise,
                e.entry_date AS entry_date, e.kind AS entry_kind
         FROM disputes d JOIN customers c ON c.id = d.customer_id
         LEFT JOIN ledger_entries e ON e.id = d.entry_id
         ${q.status === 'all' ? '' : 'WHERE d.status = $1'}
         ORDER BY d.created_at DESC LIMIT 200`,
        q.status === 'all' ? [] : [q.status],
      );
      return { disputes: res.rows };
    });
  });

  app.post('/', async (req, reply) => {
    const body = z
      .object({
        customer_id: z.string().uuid(),
        entry_id: z.string().uuid().optional(),
        reason: z.enum(DISPUTE_REASONS),
        message: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    const dispute = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      if (body.entry_id) {
        const e = await tx.query('SELECT 1 FROM ledger_entries WHERE id = $1 AND customer_id = $2', [body.entry_id, body.customer_id]);
        if (!e.rowCount) throw new HttpError(400, 'That entry does not belong to this customer', 'bad_entry');
      }
      const res = await tx.query(
        `INSERT INTO disputes (tenant_id, customer_id, entry_id, reason, message, raised_by)
         VALUES ($1, $2, $3, $4, $5, 'staff') RETURNING *`,
        [req.user.tid, body.customer_id, body.entry_id ?? null, body.reason, body.message ?? null],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'dispute.raised', res.rows[0].id);
      return res.rows[0];
    });
    return reply.status(201).send({ dispute });
  });

  app.post('/:id/resolve', staff, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ status: z.enum(['resolved', 'rejected']), resolution_note: z.string().trim().min(1).max(1000) })
      .parse(req.body);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `UPDATE disputes SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = now()
         WHERE id = $4 AND status = 'open' RETURNING *`,
        [body.status, body.resolution_note, req.user.sub, id],
      );
      if (!res.rows[0]) throw new HttpError(404, 'Open dispute not found', 'not_found');
      await audit(tx, req.user.tid, `user:${req.user.sub}`, `dispute.${body.status}`, id);
      return { dispute: res.rows[0] };
    });
  });
}
