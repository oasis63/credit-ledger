import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';
import { AGING_BUCKETS, todayIso, type Aging } from '../domain/ledger.js';
import { customerSummaries, settlePromises } from '../services/customers.js';

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const now = () => app.deps.now?.() ?? new Date();

  app.get('/dashboard', { preHandler: app.requireRole('owner', 'accountant') }, async (req) => {
    const asOf = todayIso(now());
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      await settlePromises(tx, asOf);
      const summaries = await customerSummaries(tx, asOf);
      const totalAging: Aging = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
      for (const c of summaries) for (const b of AGING_BUCKETS) totalAging[b] += c.aging[b];
      const risk = { green: 0, amber: 0, red: 0 };
      for (const c of summaries) if (c.balance_paise > 0) risk[c.risk.flag]++;
      const pending = await tx.query<{ total: number | null }>(
        `SELECT sum(amount_paise)::bigint AS total FROM ledger_entries
         WHERE kind = 'payment' AND payment_mode IN ('cash', 'cheque') AND handed_over_at IS NULL`,
      );
      const promisesToday = await tx.query(
        `SELECT p.*, c.name AS customer_name FROM promises p JOIN customers c ON c.id = p.customer_id
         WHERE p.status = 'pending' AND p.promised_date <= $1::date + 1 ORDER BY p.promised_date`,
        [asOf],
      );
      const disputes = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM disputes WHERE status = 'open'");
      return {
        as_of: asOf,
        receivable_paise: summaries.reduce((s, c) => s + Math.max(0, c.balance_paise), 0),
        overdue_paise: summaries.reduce((s, c) => s + c.overdue_paise, 0),
        aging: totalAging,
        customers_with_balance: summaries.filter((c) => c.balance_paise > 0).length,
        risk,
        open_disputes: disputes.rows[0]!.n,
        cash_pending_handover_paise: pending.rows[0]!.total ?? 0,
        promises_due: promisesToday.rows,
        top_overdue: summaries
          .filter((c) => c.overdue_paise > 0)
          .sort((a, b) => b.overdue_paise - a.overdue_paise)
          .slice(0, 10)
          .map((c) => ({
            id: c.id,
            name: c.name,
            overdue_paise: c.overdue_paise,
            balance_paise: c.balance_paise,
            risk: c.risk,
          })),
      };
    });
  });
}
