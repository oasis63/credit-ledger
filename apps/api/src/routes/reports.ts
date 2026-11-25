import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { withTenant } from '../db.js';
import { addDays, AGING_BUCKETS, todayIso, type Aging } from '../domain/ledger.js';
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

  const range = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .transform((v) => {
      const to = v.to ?? todayIso(now());
      const from = v.from ?? addDays(to, -29);
      if (from > to) throw new HttpError(400, '"from" must be before "to"', 'bad_range');
      if (addDays(from, 400) < to) throw new HttpError(400, 'Choose a range of at most 400 days', 'bad_range');
      return { from, to };
    });
  const staff = { preHandler: app.requireRole('owner', 'accountant') };

  /** Daily collections and billing for charts, plus totals by payment mode and by salesman. */
  app.get('/trend', staff, async (req) => {
    const { from, to } = range.parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const days = await tx.query<{ day: string; collected: number; billed: number; payments: number }>(
        `SELECT d::date::text AS day,
                coalesce(sum(e.amount_paise) FILTER (WHERE e.kind = 'payment'), 0)::bigint AS collected,
                coalesce(sum(e.amount_paise) FILTER (WHERE e.kind = 'invoice'), 0)::bigint AS billed,
                count(e.id) FILTER (WHERE e.kind = 'payment')::int AS payments
         FROM generate_series($1::date, $2::date, interval '1 day') d
         LEFT JOIN ledger_entries e ON e.entry_date = d::date
         GROUP BY d ORDER BY d`,
        [from, to],
      );
      const modes = await tx.query<{ mode: string; amount: number; n: number }>(
        `SELECT payment_mode AS mode, sum(amount_paise)::bigint AS amount, count(*)::int AS n FROM ledger_entries
         WHERE kind = 'payment' AND entry_date BETWEEN $1 AND $2 GROUP BY payment_mode ORDER BY amount DESC`,
        [from, to],
      );
      const total = (k: 'collected' | 'billed') => days.rows.reduce((s, d) => s + Number(d[k]), 0);
      return {
        from, to,
        days: days.rows.map((d) => ({ date: d.day, collected_paise: Number(d.collected), billed_paise: Number(d.billed), payments: d.payments })),
        by_mode: modes.rows.map((m) => ({ mode: m.mode, amount_paise: Number(m.amount), count: m.n })),
        collected_paise: total('collected'),
        billed_paise: total('billed'),
      };
    });
  });

  /** Salesman performance: collections vs target, visits and outcomes. */
  app.get('/salesmen', staff, async (req) => {
    const { from, to } = range.parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const rows = await tx.query(
        `SELECT u.id, u.name, u.role, u.active, u.daily_target_paise,
                coalesce((SELECT sum(amount_paise) FROM ledger_entries e WHERE e.kind = 'payment' AND e.collected_by = u.id AND e.entry_date BETWEEN $1 AND $2), 0)::bigint AS collected_paise,
                (SELECT count(*) FROM ledger_entries e WHERE e.kind = 'payment' AND e.collected_by = u.id AND e.entry_date BETWEEN $1 AND $2)::int AS collections,
                (SELECT count(DISTINCT e.entry_date) FROM ledger_entries e WHERE e.kind = 'payment' AND e.collected_by = u.id AND e.entry_date BETWEEN $1 AND $2)::int AS active_days,
                coalesce((SELECT sum(amount_paise) FROM ledger_entries e WHERE e.kind = 'payment' AND e.collected_by = u.id AND e.payment_mode IN ('cash','cheque') AND e.handed_over_at IS NULL), 0)::bigint AS pending_handover_paise,
                (SELECT count(*) FROM visits v WHERE v.salesman_id = u.id AND v.visited_on BETWEEN $1 AND $2)::int AS visits,
                (SELECT count(DISTINCT v.visited_on) FROM visits v WHERE v.salesman_id = u.id AND v.visited_on BETWEEN $1 AND $2)::int AS visit_days,
                (SELECT coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) FROM (
                   SELECT outcome, count(*)::int AS n FROM visits v WHERE v.salesman_id = u.id AND v.visited_on BETWEEN $1 AND $2 GROUP BY outcome) o) AS outcomes
         FROM users u WHERE u.role = 'salesman' OR EXISTS (SELECT 1 FROM ledger_entries e WHERE e.collected_by = u.id AND e.entry_date BETWEEN $1 AND $2)
         ORDER BY collected_paise DESC, u.name`,
        [from, to],
      );
      return {
        from, to,
        salesmen: rows.rows.map((r) => {
          const workDays = Math.max(r.active_days, r.visit_days);
          const target = Number(r.daily_target_paise) * workDays;
          return {
            ...r,
            collected_paise: Number(r.collected_paise),
            pending_handover_paise: Number(r.pending_handover_paise),
            work_days: workDays,
            target_paise: target,
            achievement_pct: target > 0 ? Math.round((Number(r.collected_paise) / target) * 100) : null,
          };
        }),
      };
    });
  });

  /** GST summary for the period (for GSTR-1 / GSTR-3B preparation). Cancelled bills are listed but not counted. */
  app.get('/gst', staff, async (req) => {
    const { from, to } = range.parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const bills = await tx.query(
        `SELECT b.id, b.bill_no, b.bill_date, c.name AS customer_name, c.gstin AS customer_gstin, b.interstate, b.taxable_paise,
                b.cgst_paise, b.sgst_paise, b.igst_paise, b.round_off_paise, b.total_paise, b.cancelled_at
         FROM bills b JOIN customers c ON c.id = b.customer_id WHERE b.bill_date BETWEEN $1 AND $2 ORDER BY b.bill_date, b.bill_no`,
        [from, to],
      );
      const rates = await tx.query<{ gst_rate: number; taxable: number; tax: number }>(
        `SELECT i.gst_rate::float8 AS gst_rate, sum(i.taxable_paise)::bigint AS taxable, sum(i.tax_paise)::bigint AS tax
         FROM bill_items i JOIN bills b ON b.id = i.bill_id
         WHERE b.bill_date BETWEEN $1 AND $2 AND b.cancelled_at IS NULL GROUP BY i.gst_rate ORDER BY i.gst_rate`,
        [from, to],
      );
      const hsn = await tx.query(
        `SELECT coalesce(i.hsn, '') AS hsn, i.gst_rate::float8 AS gst_rate, sum(i.qty)::float8 AS qty, sum(i.taxable_paise)::bigint AS taxable_paise, sum(i.tax_paise)::bigint AS tax_paise
         FROM bill_items i JOIN bills b ON b.id = i.bill_id
         WHERE b.bill_date BETWEEN $1 AND $2 AND b.cancelled_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2`,
        [from, to],
      );
      const live = bills.rows.filter((b) => !b.cancelled_at);
      const sum = (k: string) => live.reduce((s, b) => s + Number(b[k]), 0);
      return {
        from, to,
        totals: {
          bills: live.length, cancelled: bills.rows.length - live.length,
          taxable_paise: sum('taxable_paise'), cgst_paise: sum('cgst_paise'), sgst_paise: sum('sgst_paise'), igst_paise: sum('igst_paise'), total_paise: sum('total_paise'),
          b2b_paise: live.filter((b) => b.customer_gstin).reduce((s, b) => s + Number(b.total_paise), 0),
          b2c_paise: live.filter((b) => !b.customer_gstin).reduce((s, b) => s + Number(b.total_paise), 0),
        },
        by_rate: rates.rows.map((r) => ({ gst_rate: r.gst_rate, taxable_paise: Number(r.taxable), tax_paise: Number(r.tax) })),
        by_hsn: hsn.rows.map((r) => ({ ...r, taxable_paise: Number(r.taxable_paise), tax_paise: Number(r.tax_paise) })),
        bills: bills.rows,
      };
    });
  });

  /** Aging per customer (for export). */
  app.get('/aging', staff, async (req) => {
    const asOf = todayIso(now());
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const list = await customerSummaries(tx, asOf);
      return {
        as_of: asOf,
        customers: list
          .filter((c) => c.balance_paise !== 0)
          .sort((a, b) => b.overdue_paise - a.overdue_paise || b.balance_paise - a.balance_paise)
          .map((c) => ({
            id: c.id, name: c.name, phone: c.phone, area: c.area, balance_paise: c.balance_paise, overdue_paise: c.overdue_paise,
            ...c.aging, risk: c.risk.flag, credit_limit_paise: c.credit_limit_paise,
          })),
      };
    });
  });
}
