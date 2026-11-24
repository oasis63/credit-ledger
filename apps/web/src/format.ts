export function rupees(paise: number | null | undefined): string {
  if (paise == null) return '—';
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const formatted = new Intl.NumberFormat('en-IN').format(whole);
  return `${negative ? '-' : ''}₹${formatted}${frac === '00' ? '' : `.${frac}`}`;
}

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
