export type EntryKind =
  | 'opening_balance'
  | 'invoice'
  | 'payment'
  | 'credit_note'
  | 'adjustment_debit'
  | 'adjustment_credit'
  | 'cheque_bounce';

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  amount_paise: number;
  entry_date: string; // YYYY-MM-DD
  due_date: string | null;
  created_at?: string | Date;
}

/** Debits increase what the customer owes; credits reduce it. */
export const DEBIT_KINDS: ReadonlySet<EntryKind> = new Set([
  'opening_balance',
  'invoice',
  'adjustment_debit',
  'cheque_bounce',
]);

export function signedAmount(e: Pick<LedgerEntry, 'kind' | 'amount_paise'>): number {
  return DEBIT_KINDS.has(e.kind) ? e.amount_paise : -e.amount_paise;
}

export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + signedAmount(e), 0);
}

export interface StatementLine extends LedgerEntry {
  debit_paise: number;
  credit_paise: number;
  running_balance_paise: number;
}

function chronological(a: LedgerEntry, b: LedgerEntry): number {
  if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function statement(entries: readonly LedgerEntry[]): StatementLine[] {
  let running = 0;
  return [...entries].sort(chronological).map((e) => {
    const s = signedAmount(e);
    running += s;
    return {
      ...e,
      debit_paise: s > 0 ? s : 0,
      credit_paise: s < 0 ? -s : 0,
      running_balance_paise: running,
    };
  });
}

export const AGING_BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export type Aging = Record<AgingBucket, number>;

export interface OpenItem {
  entry_id: string;
  due_date: string;
  original_paise: number;
  open_paise: number;
  days_overdue: number;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'not_due';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

/**
 * FIFO allocation: credits (payments, credit notes, adjustments) settle the
 * oldest debits first. What remains open is aged by days past its due date.
 * A debit without a due date is due on its entry date.
 */
export function openItems(entries: readonly LedgerEntry[], asOf: string): { items: OpenItem[]; unapplied_credit_paise: number } {
  const sorted = [...entries].sort(chronological);
  const debits = sorted
    .filter((e) => DEBIT_KINDS.has(e.kind))
    .map((e) => ({ e, open: e.amount_paise }))
    .sort((a, b) => {
      const da = a.e.due_date ?? a.e.entry_date;
      const dbb = b.e.due_date ?? b.e.entry_date;
      return da === dbb ? chronological(a.e, b.e) : da < dbb ? -1 : 1;
    });
  let credit = sorted.filter((e) => !DEBIT_KINDS.has(e.kind)).reduce((s, e) => s + e.amount_paise, 0);
  for (const d of debits) {
    if (credit <= 0) break;
    const applied = Math.min(credit, d.open);
    d.open -= applied;
    credit -= applied;
  }
  const items = debits
    .filter((d) => d.open > 0)
    .map((d) => {
      const due = d.e.due_date ?? d.e.entry_date;
      return {
        entry_id: d.e.id,
        due_date: due,
        original_paise: d.e.amount_paise,
        open_paise: d.open,
        days_overdue: Math.max(0, daysBetween(due, asOf)),
      };
    });
  return { items, unapplied_credit_paise: credit };
}

export function aging(entries: readonly LedgerEntry[], asOf: string): Aging {
  const result: Aging = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const item of openItems(entries, asOf).items) {
    result[bucketFor(item.days_overdue)] += item.open_paise;
  }
  return result;
}

export function overdueTotal(a: Aging): number {
  return a.d1_30 + a.d31_60 + a.d61_90 + a.d90_plus;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date(), timeZone = 'Asia/Kolkata'): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
