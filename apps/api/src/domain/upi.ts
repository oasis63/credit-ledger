const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_RE.test(vpa);
}

/**
 * Build a UPI deep link (NPCI "upi://pay" intent). Money goes straight to the
 * distributor's own VPA: no gateway, no MDR, and this system never holds funds.
 */
export function buildUpiLink(params: {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
  transactionRef?: string;
}): string {
  if (!isValidVpa(params.vpa)) throw new Error('invalid UPI VPA');
  if (!Number.isInteger(params.amountPaise) || params.amountPaise <= 0) throw new Error('invalid amount');
  const q = new URLSearchParams();
  q.set('pa', params.vpa);
  q.set('pn', params.payeeName.slice(0, 50));
  q.set('am', (params.amountPaise / 100).toFixed(2));
  q.set('cu', 'INR');
  q.set('tn', params.note.slice(0, 80));
  if (params.transactionRef) q.set('tr', params.transactionRef.slice(0, 35));
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
