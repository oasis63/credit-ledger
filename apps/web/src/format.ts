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
