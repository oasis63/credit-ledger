import { formatDate, formatRupees, MODE_LABEL, type NewCollection } from '@credit-ledger/shared';
import { esc, PDF_CSS } from './share';

/** A simple, printable payment receipt for the shop (PDF via the share sheet). */
export function receiptHtml(p: NewCollection, customerName: string, collectedBy: string, receiptNo: string | null): string {
  const paise = Math.round(Number(p.amount) * 100);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>
  <div class="row"><div><h1>Payment receipt</h1><div class="muted">${receiptNo ? `Receipt #${esc(receiptNo)}` : `Ref ${esc(p.client_ref.slice(0, 8).toUpperCase())}`}</div></div>
  <div style="text-align:right"><div class="label">Date</div><b>${esc(formatDate(p.collected_on))}</b></div></div>
  <div class="box"><div class="label">Received from</div><b style="font-size:16px">${esc(customerName)}</b>
  <div style="margin-top:14px" class="label">Amount</div><div class="big">${esc(formatRupees(paise))}</div>
  <div style="margin-top:10px">${esc(MODE_LABEL[p.payment_mode])}${p.payment_ref ? ` · ${esc(p.payment_ref)}` : ''}</div>
  ${p.note ? `<div class="muted" style="margin-top:6px">${esc(p.note)}</div>` : ''}</div>
  <p class="muted" style="margin-top:20px">Collected by ${esc(collectedBy)}. This amount will appear in your statement.</p>
  </body></html>`;
}
