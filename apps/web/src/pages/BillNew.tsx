import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api, type CustomerSummary } from '../api';
import { addDays, rupees, todayIso } from '../format';
import { useApi } from '../hooks';
import { Card, ErrorNote, Field, Money, PageHeader, Pill, RiskBadge } from '../ui';

interface Line { key: number; description: string; hsn: string; qty: string; unit: string; rate: string; discount_pct: string; gst_rate: string }
interface Preview {
  interstate: boolean;
  lines: Array<{ taxable_paise: number; tax_paise: number; amount_paise: number }>;
  subtotal_paise: number; discount_paise: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  round_off_paise: number; total_paise: number;
  by_rate: Array<{ gst_rate: number; taxable_paise: number; tax_paise: number }>;
}

const RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
const UNITS = ['pcs', 'box', 'strip', 'kg', 'g', 'ltr', 'ml', 'pack', 'dozen', 'case', 'bag', 'mtr'];
let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, description: '', hsn: '', qty: '1', unit: 'pcs', rate: '', discount_pct: '', gst_rate: '18' });

/** Remember items billed before, so the next bill autocompletes rate, HSN and GST. */
const RECENT_KEY = 'cl_recent_items';
function recentItems(): Array<Omit<Line, 'key' | 'qty'>> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<Omit<Line, 'key' | 'qty'>>;
  } catch {
    return [];
  }
}
function rememberItems(lines: Line[]) {
  const map = new Map(recentItems().map((i) => [i.description.toLowerCase(), i]));
  for (const l of lines) if (l.description) map.set(l.description.toLowerCase(), { description: l.description, hsn: l.hsn, unit: l.unit, rate: l.rate, discount_pct: l.discount_pct, gst_rate: l.gst_rate });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...map.values()].slice(-300)));
  } catch {
    /* ignore */
  }
}

export function BillNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const customers = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const [customerId, setCustomerId] = useState(params.get('customer') ?? '');
  const [billDate, setBillDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = useMemo(recentItems, []);
  const customer = customers.data?.customers.find((c) => c.id === customerId) ?? null;
  const seq = useRef(0);

  useEffect(() => {
    if (customer && !dueDate) setDueDate(addDays(billDate, customer.credit_days));
  }, [customer, billDate, dueDate]);

  const items = lines
    .filter((l) => l.description.trim() && l.rate.trim())
    .map((l) => ({ description: l.description.trim(), hsn: l.hsn.trim() || null, qty: Number(l.qty || 0), unit: l.unit, rate: l.rate.trim(), discount_pct: Number(l.discount_pct || 0), gst_rate: Number(l.gst_rate) }));

  useEffect(() => {
    if (items.length === 0) {
      setPreview(null);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      api<Preview>('/api/bills/preview', { method: 'POST', body: { customer_id: customerId || undefined, items } })
        .then((p) => my === seq.current && (setPreview(p), setPreviewError(null)))
        .catch((e: Error) => my === seq.current && setPreviewError(e.message));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), customerId]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, description: string) => {
    const known = recent.find((r) => r.description.toLowerCase() === description.toLowerCase());
    update(key, known ? { ...known, description } : { description });
  };
  // Preview lines line up with the items that are filled in.
  const previewFor = (() => {
    const map = new Map<number, Preview['lines'][number]>();
    let i = 0;
    for (const l of lines) if (l.description.trim() && l.rate.trim()) map.set(l.key, preview?.lines[i++]!);
    return map;
  })();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ bill: { id: string } }>('/api/bills', {
        method: 'POST',
        body: { customer_id: customerId, bill_date: billDate, due_date: dueDate || undefined, notes: notes || undefined, items },
      });
      rememberItems(lines);
      nav(`/bills/${r.bill.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader back={<Link to="/bills" className="back"><ArrowLeft size={15} />Bills</Link>} title="New GST bill" subtitle="Totals and tax update as you type. Saving posts the bill to the customer's ledger." />
      <div className="bill-layout">
        <div className="stack">
          <Card title="Customer">
            <div className="form-grid">
              <Field label="Bill to" span={2}>
                <select value={customerId} onChange={(e) => (setCustomerId(e.target.value), setDueDate(''))} autoFocus>
                  <option value="">Choose a customer…</option>
                  {(customers.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.area ? ` · ${c.area}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Bill date"><input type="date" value={billDate} onChange={(e) => (setBillDate(e.target.value), setDueDate(''))} /></Field>
              <Field label="Due date" hint={customer ? `${customer.credit_days} days credit` : undefined}><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            </div>
            {customer && (
              <div className="customer-strip">
                <span>Owes <b>{rupees(customer.balance_paise)}</b></span>
                {customer.overdue_paise > 0 && <span className="neg">Overdue {rupees(customer.overdue_paise)}</span>}
                <RiskBadge flag={customer.risk.flag} />
                {customer.gstin ? <Pill tone="blue">GSTIN {customer.gstin}</Pill> : <Pill>Unregistered (B2C)</Pill>}
                {customer.credit_limit_paise > 0 && customer.balance_paise + (preview?.total_paise ?? 0) > customer.credit_limit_paise && (
                  <Pill tone="red">Crosses credit limit of {rupees(customer.credit_limit_paise)}</Pill>
                )}
              </div>
            )}
          </Card>

          <Card title="Items" pad={false}>
            <datalist id="recent-items">{recent.map((r) => <option key={r.description} value={r.description} />)}</datalist>
            <div className="table-wrap">
              <table className="table items-table">
                <thead>
                  <tr><th>Item</th><th>HSN</th><th>Qty</th><th>Unit</th><th>Rate ₹</th><th>Disc %</th><th>GST %</th><th className="num">Amount</th><th /></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const p = previewFor.get(l.key);
                    return (
                      <tr key={l.key}>
                        <td><input list="recent-items" value={l.description} placeholder={`Item ${i + 1}`} onChange={(e) => pickItem(l.key, e.target.value)} /></td>
                        <td><input className="w-hsn" value={l.hsn} inputMode="numeric" placeholder="3004" onChange={(e) => update(l.key, { hsn: e.target.value })} /></td>
                        <td><input className="w-qty" value={l.qty} inputMode="decimal" onChange={(e) => update(l.key, { qty: e.target.value })} /></td>
                        <td>
                          <select value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                        </td>
                        <td><input className="w-rate" value={l.rate} inputMode="decimal" placeholder="0.00" onChange={(e) => update(l.key, { rate: e.target.value })} /></td>
                        <td><input className="w-disc" value={l.discount_pct} inputMode="decimal" placeholder="0" onChange={(e) => update(l.key, { discount_pct: e.target.value })} /></td>
                        <td>
                          <select value={l.gst_rate} onChange={(e) => update(l.key, { gst_rate: e.target.value })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
                        </td>
                        <td className="num">{p ? <Money paise={p.amount_paise} strong /> : <span className="muted">—</span>}</td>
                        <td>
                          <button className="icon-btn" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-pad">
              <button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus size={15} />Add item</button>
            </div>
          </Card>

          <Card title="Notes">
            <textarea rows={2} className="full" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Printed on the bill, e.g. scheme details or transport" />
          </Card>
        </div>

        <aside className="bill-summary">
          <Card title="Summary">
            {preview ? (
              <dl className="totals">
                <dt>Subtotal</dt><dd><Money paise={preview.subtotal_paise} /></dd>
                {preview.discount_paise > 0 && (<><dt>Discount</dt><dd className="pos">−{rupees(preview.discount_paise)}</dd></>)}
                <dt>Taxable value</dt><dd><Money paise={preview.taxable_paise} /></dd>
                {preview.interstate ? (
                  <><dt>IGST</dt><dd><Money paise={preview.igst_paise} /></dd></>
                ) : (
                  <><dt>CGST</dt><dd><Money paise={preview.cgst_paise} /></dd><dt>SGST</dt><dd><Money paise={preview.sgst_paise} /></dd></>
                )}
                {preview.round_off_paise !== 0 && (<><dt>Round off</dt><dd>{preview.round_off_paise > 0 ? '+' : '−'}{rupees(Math.abs(preview.round_off_paise))}</dd></>)}
                <dt className="total">Total</dt><dd className="total"><Money paise={preview.total_paise} strong /></dd>
              </dl>
            ) : (
              <p className="muted">Add an item with a rate to see the total.</p>
            )}
            {preview && <p className="muted small">{preview.interstate ? 'Inter-state supply: IGST applies.' : 'Intra-state supply: CGST + SGST.'}</p>}
            <ErrorNote error={previewError ?? error} />
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !customerId || items.length === 0 || !preview} onClick={save}>
              {busy ? 'Saving…' : `Save bill${preview ? ` · ${rupees(preview.total_paise)}` : ''}`}
            </button>
            {!customerId && <p className="muted small">Choose a customer to save.</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}
