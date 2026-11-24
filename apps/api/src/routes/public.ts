import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { aging, balanceOf, overdueTotal, statement, todayIso } from '../domain/ledger.js';
import { verifyStatementToken } from '../domain/statementToken.js';
import { buildUpiLink } from '../domain/upi.js';
import { ENTRY_COLUMNS } from '../services/customers.js';
import { DISPUTE_REASONS } from './disputes.js';

/**
 * Retailer-facing endpoints, authorised by the signed link in their WhatsApp
 * message. Read-only except for raising a dispute.
 */
export async function publicRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const now = () => app.deps.now?.() ?? new Date();

  function claimsFrom(token: string) {
    const claims = verifyStatementToken(token, app.deps.config.STATEMENT_LINK_SECRET, Math.floor(now().getTime() / 1000));
    if (!claims) throw new HttpError(404, 'This link is invalid or has expired. Ask your supplier for a new one.', 'link_invalid');
    return claims;
  }

  app.get('/statement/:token', limited, async (req) => {
    const { token } = z.object({ token: z.string().max(600) }).parse(req.params);
    const claims = claimsFrom(token);
    const asOf = todayIso(now());
    return withTenant(app.deps.db, claims.tid, async (tx) => {
      const tenant = (await tx.query<{ name: string; upi_vpa: string | null; upi_payee_name: string | null }>(
        'SELECT name, upi_vpa, upi_payee_name FROM tenants',
      )).rows[0];
      const customer = (await tx.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [claims.cid])).rows[0];
      if (!tenant || !customer) throw new HttpError(404, 'Statement not found', 'not_found');
      const entries = (await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE customer_id = $1`, [claims.cid])).rows;
      const disputes = (
        await tx.query(
          'SELECT id, entry_id, reason, message, status, resolution_note, created_at FROM disputes WHERE customer_id = $1 ORDER BY created_at DESC',
          [claims.cid],
        )
      ).rows;
      const ag = aging(entries, asOf);
      const balance = balanceOf(entries);
      const overdue = overdueTotal(ag);
      const payAmount = overdue > 0 ? overdue : balance;
      const upi =
        tenant.upi_vpa && payAmount > 0
          ? buildUpiLink({
              vpa: tenant.upi_vpa,
              payeeName: tenant.upi_payee_name ?? tenant.name,
              amountPaise: payAmount,
              note: `Payment from ${customer.name}`.slice(0, 80),
            })
          : null;
      const lines = statement(entries).map((l) => ({
        id: l.id,
        kind: l.kind,
        entry_date: l.entry_date,
        due_date: l.due_date,
        reference: (l as { reference?: string | null }).reference ?? null,
        debit_paise: l.debit_paise,
        credit_paise: l.credit_paise,
        running_balance_paise: l.running_balance_paise,
      }));
      return {
        business_name: tenant.name,
        customer_name: customer.name,
        as_of: asOf,
        balance_paise: balance,
        overdue_paise: overdue,
        aging: ag,
        lines: lines.slice(-200),
        disputes,
        upi_link: upi,
        pay_amount_paise: payAmount > 0 ? payAmount : 0,
      };
    });
  });

  app.post('/statement/:token/disputes', limited, async (req, reply) => {
    const { token } = z.object({ token: z.string().max(600) }).parse(req.params);
    const claims = claimsFrom(token);
    const body = z
      .object({
        entry_id: z.string().uuid().optional(),
        reason: z.enum(DISPUTE_REASONS),
        message: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    const dispute = await withTenant(app.deps.db, claims.tid, async (tx) => {
      if (body.entry_id) {
        const e = await tx.query('SELECT 1 FROM ledger_entries WHERE id = $1 AND customer_id = $2', [body.entry_id, claims.cid]);
        if (!e.rowCount) throw new HttpError(400, 'That line is not on your statement', 'bad_entry');
      }
      const open = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM disputes WHERE customer_id = $1 AND status = 'open'",
        [claims.cid],
      );
      if (open.rows[0]!.n >= 20) throw new HttpError(429, 'Too many open disputes. Please call your supplier.', 'too_many');
      const res = await tx.query(
        `INSERT INTO disputes (tenant_id, customer_id, entry_id, reason, message, raised_by)
         VALUES ($1, $2, $3, $4, $5, 'retailer') RETURNING id, entry_id, reason, message, status, created_at`,
        [claims.tid, claims.cid, body.entry_id ?? null, body.reason, body.message ?? null],
      );
      await audit(tx, claims.tid, `retailer:${claims.cid}`, 'dispute.raised', res.rows[0].id);
      return res.rows[0];
    });
    return reply.status(201).send({ dispute });
  });
}
