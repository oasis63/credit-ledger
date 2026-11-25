import type { Tx } from '../db.js';
import type { LedgerEntry } from '../domain/ledger.js';
import { aging, balanceOf, overdueTotal, todayIso } from '../domain/ledger.js';
import { assessRisk } from '../domain/risk.js';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  gstin: string | null;
  credit_limit_paise: number;
  credit_days: number;
  language: 'en' | 'hi';
  tally_ledger_name: string | null;
  tally_balance_paise: number | null;
  tally_synced_at: string | null;
  created_at: string;
}

export const CUSTOMER_COLUMNS =
  'id, name, phone, gstin, credit_limit_paise, credit_days, language, tally_ledger_name, tally_balance_paise, tally_synced_at, created_at';

export const ENTRY_COLUMNS =
  'id, customer_id, kind, amount_paise, entry_date, due_date, reference, note, payment_mode, payment_ref, collected_by, handed_over_at, created_by, created_at, client_ref';

export async function entriesByCustomer(tx: Tx, customerIds?: string[]): Promise<Map<string, LedgerEntry[]>> {
  const res = customerIds
    ? await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE customer_id = ANY($1)`, [customerIds])
    : await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries`);
  const map = new Map<string, LedgerEntry[]>();
  for (const row of res.rows as Array<LedgerEntry & { customer_id: string }>) {
    const list = map.get(row.customer_id) ?? [];
    list.push(row);
    map.set(row.customer_id, list);
  }
  return map;
}

async function countsByCustomer(tx: Tx, sql: string): Promise<Map<string, number>> {
  const res = await tx.query<{ customer_id: string; n: number }>(sql);
  return new Map(res.rows.map((r) => [r.customer_id, Number(r.n)]));
}

/** Balance, aging and risk for every customer of the current tenant. */
export async function customerSummaries(tx: Tx, asOf: string = todayIso()) {
  const customers = (await tx.query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers ORDER BY name`)).rows;
  const entries = await entriesByCustomer(tx);
  const disputes = await countsByCustomer(
    tx,
    "SELECT customer_id, count(*) AS n FROM disputes WHERE status = 'open' GROUP BY customer_id",
  );
  const broken = await countsByCustomer(
    tx,
    "SELECT customer_id, count(*) AS n FROM promises WHERE status = 'broken' GROUP BY customer_id",
  );
  return customers.map((c) => {
    const list = entries.get(c.id) ?? [];
    const ag = aging(list, asOf);
    const risk = assessRisk({
      entries: list,
      credit_limit_paise: c.credit_limit_paise,
      open_disputes: disputes.get(c.id) ?? 0,
      broken_promises: broken.get(c.id) ?? 0,
      as_of: asOf,
    });
    return {
      ...c,
      balance_paise: balanceOf(list),
      overdue_paise: overdueTotal(ag),
      aging: ag,
      risk,
      open_disputes: disputes.get(c.id) ?? 0,
    };
  });
}

/** Mark pending promises whose date has passed as kept or broken, based on payments since. */
export async function settlePromises(tx: Tx, asOf: string = todayIso()): Promise<number> {
  const res = await tx.query(
    `UPDATE promises p SET status = CASE WHEN EXISTS (
        SELECT 1 FROM ledger_entries e
        WHERE e.customer_id = p.customer_id AND e.kind = 'payment'
          AND e.created_at >= p.created_at
          AND (p.amount_paise IS NULL OR e.amount_paise >= p.amount_paise)
      ) THEN 'kept' ELSE 'broken' END
     WHERE p.status = 'pending' AND p.promised_date < $1::date`,
    [asOf],
  );
  return res.rowCount ?? 0;
}
