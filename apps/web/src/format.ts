import { formatRupees } from '@credit-ledger/shared';

/** Same Indian-style formatting as the mobile app (shared package). */
export const rupees = formatRupees;

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const KIND_LABEL: Record<string, string> = {
  opening_balance: 'Opening balance',
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit note',
  adjustment_debit: 'Adjustment (+)',
  adjustment_credit: 'Adjustment (−)',
  cheque_bounce: 'Cheque bounced',
};

export const REASON_LABEL: Record<string, string> = {
  amount_wrong: 'Amount is wrong',
  return_not_applied: 'Return not applied',
  scheme_discount: 'Scheme or discount missing',
  already_paid: 'Already paid',
  not_received: 'Goods not received',
  other: 'Other',
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const OUTCOME_LABEL: Record<string, string> = {
  collected: 'Collected',
  promised: 'Promised',
  no_payment: 'No payment',
  shop_closed: 'Shop closed',
  owner_absent: 'Owner absent',
  order_taken: 'Order taken',
};

export const MODE_LABEL: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', upi: 'UPI', bank: 'Bank' };

/** Today's date in India as YYYY-MM-DD. */
export function todayIso(d = new Date()): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "+91 98765 43210" from "919876543210". */
export function phone(p: string): string {
  const m = p.match(/^91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : `+${p}`;
}
