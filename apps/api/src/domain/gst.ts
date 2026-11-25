/**
 * GST bill maths. All money is integer paise; quantities may have up to 3
 * decimals (e.g. 1.5 kg) and GST rates up to 2 (0.25%). Everything is done in
 * integers to avoid floating-point drift.
 *
 * Intra-state bills split tax equally into CGST and SGST (each computed at
 * half the rate, so they are always equal); inter-state bills use IGST.
 */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

export interface BillItemInput {
  description: string;
  hsn?: string | null;
  qty: number;
  unit?: string;
  rate_paise: number;
  discount_pct?: number;
  gst_rate: number;
}

export interface BillLine extends Required<Omit<BillItemInput, 'hsn'>> {
  hsn: string | null;
  gross_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  amount_paise: number;
}

export interface BillTotals {
  lines: BillLine[];
  subtotal_paise: number; // before discounts
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  round_off_paise: number;
  total_paise: number;
  by_rate: Array<{ gst_rate: number; taxable_paise: number; tax_paise: number }>;
}

const toMilli = (qty: number) => Math.round(qty * 1000);
const toBasis = (pct: number) => Math.round(pct * 100); // 18% -> 1800

/** Round half away from zero for a positive numerator / denominator. */
const div = (num: number, den: number) => Math.round(num / den);

export function computeBill(items: BillItemInput[], opts: { interstate: boolean }): BillTotals {
  if (items.length === 0) throw new Error('A bill needs at least one item');
  const lines: BillLine[] = items.map((it) => {
    if (!(it.qty > 0)) throw new Error(`Quantity must be more than 0 for "${it.description}"`);
    if (Math.abs(it.qty * 1000 - toMilli(it.qty)) > 1e-6) {
      throw new Error('Quantity can have at most 3 decimals');
    }
    if (!Number.isInteger(it.rate_paise) || it.rate_paise < 0) throw new Error('Rate must be a positive amount');
    if (!(GST_RATES as readonly number[]).includes(it.gst_rate)) throw new Error(`GST rate ${it.gst_rate}% is not valid`);
    const discountPct = it.discount_pct ?? 0;
    if (discountPct < 0 || discountPct > 100) throw new Error('Discount must be between 0 and 100%');
    const gross = div(toMilli(it.qty) * it.rate_paise, 1000);
    const discount = div(gross * toBasis(discountPct), 10_000);
    const taxable = gross - discount;
    const bp = toBasis(it.gst_rate);
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (opts.interstate) igst = div(taxable * bp, 10_000);
    else {
      cgst = div(taxable * bp, 20_000);
      sgst = cgst;
    }
    const tax = cgst + sgst + igst;
    return {
      description: it.description,
      hsn: it.hsn ?? null,
      qty: it.qty,
      unit: it.unit ?? 'pcs',
      rate_paise: it.rate_paise,
      discount_pct: discountPct,
      gst_rate: it.gst_rate,
      gross_paise: gross,
      discount_paise: discount,
      taxable_paise: taxable,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: igst,
      tax_paise: tax,
      amount_paise: taxable + tax,
    };
  });
  const sum = (k: keyof BillLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const taxable = sum('taxable_paise');
  const tax = sum('tax_paise');
  const exact = taxable + tax;
  const total = Math.round(exact / 100) * 100; // round to the nearest rupee
  const rates = new Map<number, { taxable_paise: number; tax_paise: number }>();
  for (const l of lines) {
    const r = rates.get(l.gst_rate) ?? { taxable_paise: 0, tax_paise: 0 };
    r.taxable_paise += l.taxable_paise;
    r.tax_paise += l.tax_paise;
    rates.set(l.gst_rate, r);
  }
  if (total <= 0) throw new Error('Bill total must be more than zero');
  return {
    lines,
    subtotal_paise: sum('gross_paise'),
    discount_paise: sum('discount_paise'),
    taxable_paise: taxable,
    cgst_paise: sum('cgst_paise'),
    sgst_paise: sum('sgst_paise'),
    igst_paise: sum('igst_paise'),
    tax_paise: tax,
    round_off_paise: total - exact,
    total_paise: total,
    by_rate: [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([gst_rate, v]) => ({ gst_rate, ...v })),
  };
}

/** GSTIN's first two digits are the state code. Different state => inter-state (IGST). */
export function isInterstate(sellerStateCode: string | null, buyerGstin: string | null): boolean {
  if (!sellerStateCode || !buyerGstin || !/^\d{2}/.test(buyerGstin)) return false;
  return buyerGstin.slice(0, 2) !== sellerStateCode;
}

/** Indian number to words for bills: 12345.50 -> "Twelve Thousand Three Hundred Forty Five Rupees and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
    'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number) => (n < 20 ? ones[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n: number) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  const words = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 10_000_000);
    const lakh = Math.floor((n % 10_000_000) / 100_000);
    const thousand = Math.floor((n % 100_000) / 1000);
    const rest = n % 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  };
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `${words(rupees)} Rupees${p ? ` and ${two(p)} Paise` : ''} Only`;
}
