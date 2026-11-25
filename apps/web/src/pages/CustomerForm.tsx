import { useState } from 'react';
import { api, type CustomerSummary } from '../api';
import { Drawer, ErrorNote, Field } from '../ui';

export interface Beat { id: string; name: string }

/** Add or edit a customer in a side drawer. */
export function CustomerForm({ customer, beats, areas, onClose, onSaved }: {
  customer?: CustomerSummary | null;
  beats: Beat[];
  areas: string[];
  onClose: () => void;
  onSaved: (c: CustomerSummary) => void;
}) {
  const c = customer;
  const [f, setF] = useState({
    name: c?.name ?? '',
    contact_name: c?.contact_name ?? '',
    phone: c ? c.phone.replace(/^91/, '') : '',
    gstin: c?.gstin ?? '',
    area: c?.area ?? '',
    address: c?.address ?? '',
    tags: (c?.tags ?? []).join(', '),
    credit_limit: c ? String(c.credit_limit_paise / 100) : '',
    credit_days: String(c?.credit_days ?? 30),
    language: c?.language ?? 'en',
    beat_id: c?.beat_id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: f.name,
        contact_name: f.contact_name || null,
        phone: f.phone,
        gstin: f.gstin || null,
        area: f.area || null,
        address: f.address || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
        credit_limit: f.credit_limit || '0',
        credit_days: Number(f.credit_days || 0),
        language: f.language,
        beat_id: f.beat_id || null,
      };
      const r = c
        ? await api<{ customer: CustomerSummary }>(`/api/customers/${c.id}`, { method: 'PATCH', body })
        : await api<{ customer: CustomerSummary }>('/api/customers', { method: 'POST', body });
      onSaved(r.customer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={c ? `Edit ${c.name}` : 'Add a customer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.name || !f.phone} onClick={save}>{busy ? 'Saving…' : c ? 'Save changes' : 'Add customer'}</button>
        </>
      }
    >
      <form className="form-grid" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label="Shop / business name" span={2}><input value={f.name} onChange={set('name')} placeholder="e.g. Sharma General Store" autoFocus required /></Field>
        <Field label="Owner / contact person"><input value={f.contact_name} onChange={set('contact_name')} placeholder="e.g. Ramesh Sharma" /></Field>
        <Field label="WhatsApp number"><input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" required /></Field>
        <Field label="Area / locality" hint="Used for filters and planning beats">
          <input value={f.area} onChange={set('area')} list="areas" placeholder="e.g. Karol Bagh" />
          <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
        <Field label="Beat (route)">
          <select value={f.beat_id} onChange={set('beat_id')}>
            <option value="">Not on a beat</option>
            {beats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Address" span={2}><textarea rows={2} value={f.address} onChange={set('address')} /></Field>
        <Field label="GSTIN (optional)" hint="Bills to other states use IGST automatically"><input value={f.gstin} onChange={set('gstin')} placeholder="07AAACS1234A1Z5" /></Field>
        <Field label="Tags" hint="Comma separated, e.g. pharmacy, priority"><input value={f.tags} onChange={set('tags')} /></Field>
        <Field label="Credit limit (₹)" hint="0 = no limit"><input value={f.credit_limit} onChange={set('credit_limit')} inputMode="decimal" /></Field>
        <Field label="Credit days"><input type="number" min={0} max={365} value={f.credit_days} onChange={set('credit_days')} /></Field>
        <Field label="Message language">
          <select value={f.language} onChange={set('language')}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </Field>
      </form>
      <ErrorNote error={error} />
    </Drawer>
  );
}
