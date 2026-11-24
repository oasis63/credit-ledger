/** Convert a rupee amount (number or decimal string) to integer paise, rejecting >2 decimals. */
export function rupeesToPaise(input: number | string): number {
  const s = typeof input === 'number' ? input.toString() : input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`invalid rupee amount: ${input}`);
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error('amount too large');
  return paise;
}

/** Format paise as an Indian-grouped rupee string, e.g. 1234567 -> "₹12,345.67". */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const digits = String(rupees);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}${frac === '00' ? '' : `.${frac}`}`;
}
