import { useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { api } from '../api';
import { date, rupees } from '../format';
import { useApi } from '../hooks';
import { ActionButton, Avatar, Card, ErrorNote, Field, Loading, Modal, PageHeader, Pill, useToast } from '../ui';

interface Tenant {
  id: string; name: string; upi_vpa: string | null; upi_payee_name: string | null; wa_phone_number_id: string | null;
  gstin: string | null; address: string | null; phone: string | null; state_code: string | null; bill_prefix: string; next_bill_no: number;
}
interface UserRow { id: string; name: string; email: string; role: string; active: boolean; daily_target_paise: number }

export function Settings() {
  const toast = useToast();
  const tenant = useApi<{ tenant: Tenant }>('/api/settings');
  const users = useApi<{ users: UserRow[] }>('/api/settings/users');
  const keys = useApi<{ keys: Array<{ id: string; label: string; last_used: string | null; created_at: string }> }>('/api/settings/agent-keys');
  const [t, setT] = useState<Tenant | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => setT(tenant.data?.tenant ?? null), [tenant.data]);
  const set = (k: keyof Tenant) => (e: { target: { value: string } }) => setT((x) => (x ? { ...x, [k]: e.target.value } : x));

  if (tenant.loading && !t) return <Loading />;
  return (
    <>
      <PageHeader title="Settings" subtitle="Your business details, payments, team and integrations." />
      <ErrorNote error={tenant.error} />
      {t && (
        <div className="grid-2">
          <Card title="Business details (printed on bills)">
            <div className="form-grid">
              <Field label="Business name" span={2}><input value={t.name} onChange={set('name')} /></Field>
              <Field label="GSTIN" hint="State code is filled in from your GSTIN"><input value={t.gstin ?? ''} onChange={set('gstin')} placeholder="07AAACS1234A1Z5" /></Field>
              <Field label="State code" hint="e.g. 07 Delhi, 27 Maharashtra"><input value={t.state_code ?? ''} onChange={set('state_code')} maxLength={2} /></Field>
              <Field label="Address" span={2}><textarea rows={2} value={t.address ?? ''} onChange={set('address')} /></Field>
              <Field label="Phone"><input value={t.phone ?? ''} onChange={set('phone')} /></Field>
              <Field label="Bill number" hint={`Next bill: ${t.bill_prefix}${t.next_bill_no}`}>
                <div className="split-input">
                  <input value={t.bill_prefix} onChange={set('bill_prefix')} placeholder="INV-" aria-label="Prefix" />
                  <input type="number" min={1} value={t.next_bill_no} onChange={(e) => setT({ ...t, next_bill_no: Number(e.target.value) })} aria-label="Next number" />
                </div>
              </Field>
            </div>
          </Card>
          <Card title="Payments and WhatsApp">
            <div className="form-grid">
              <Field label="Your UPI ID" hint="Customers pay straight into your bank. Shown as a QR on bills and statements." span={2}>
                <input value={t.upi_vpa ?? ''} onChange={set('upi_vpa')} placeholder="shop@okhdfcbank" />
              </Field>
              <Field label="Name shown in UPI apps" span={2}><input value={t.upi_payee_name ?? ''} onChange={set('upi_payee_name')} /></Field>
              <Field label="WhatsApp phone number ID" hint="From Meta Business Manager. Leave empty to only log messages." span={2}>
                <input value={t.wa_phone_number_id ?? ''} onChange={set('wa_phone_number_id')} />
              </Field>
            </div>
          </Card>
        </div>
      )}
      {t && (
        <div className="save-bar">
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              await api('/api/settings', {
                method: 'PATCH',
                body: {
                  name: t.name, upi_vpa: t.upi_vpa || null, upi_payee_name: t.upi_payee_name || null, wa_phone_number_id: t.wa_phone_number_id || null,
                  gstin: t.gstin || null, address: t.address || null, phone: t.phone || null, state_code: t.state_code || null,
                  bill_prefix: t.bill_prefix, next_bill_no: t.next_bill_no,
                },
              });
              tenant.reload();
            }}
            okText="Settings saved"
          >
            Save settings
          </ActionButton>
        </div>
      )}

      <Card title="Team" actions={<button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><UserPlus size={15} />Add member</button>} pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th className="num">Daily target</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(users.data?.users ?? []).map((u) => (
                <tr key={u.id} className={u.active ? '' : 'row-muted'}>
                  <td><span className="with-icon"><Avatar name={u.name} size={30} /><span><b>{u.name}</b><span className="cell-sub">{u.email}</span></span></span></td>
                  <td><Pill tone={u.role === 'owner' ? 'violet' : u.role === 'accountant' ? 'blue' : 'neutral'}>{u.role}</Pill></td>
                  <td className="num">{u.role === 'salesman' ? (u.daily_target_paise ? rupees(u.daily_target_paise) : <span className="muted">—</span>) : ''}</td>
                  <td>{u.active ? <Pill tone="green">Active</Pill> : <Pill>Inactive</Pill>}</td>
                  <td>
                    {u.role !== 'owner' && (
                      <ActionButton className="btn btn-sm btn-ghost" onClick={async () => (await api(`/api/settings/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), users.reload())}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </ActionButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small card-pad">Set daily collection targets for salesmen in Reports → Salesmen.</p>
      </Card>

      <Card title="Tally sync agent keys">
        <p className="muted small">Install the sync agent on the PC that runs Tally and give it one of these keys. It only reads from Tally.</p>
        {newKey && (
          <div className="alert alert-ok key-alert">
            <KeyRound size={16} />Copy this key now; it won't be shown again: <code>{newKey}</code>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(newKey).then(() => toast('Copied'))}><Copy size={14} />Copy</button>
          </div>
        )}
        <div className="list">
          {(keys.data?.keys ?? []).map((k) => (
            <div key={k.id} className="list-row">
              <KeyRound size={16} />
              <div className="list-main"><b>{k.label}</b><span>Created {date(k.created_at)} · last used {k.last_used ? date(k.last_used) : 'never'}</span></div>
              <ActionButton className="icon-btn" title="Revoke" onClick={async () => (await api(`/api/settings/agent-keys/${k.id}`, { method: 'DELETE' }), keys.reload())}><Trash2 size={16} /></ActionButton>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="e.g. Office PC" />
          <ActionButton
            className="btn"
            disabled={!keyLabel.trim()}
            onClick={async () => {
              const r = await api<{ key: string }>('/api/settings/agent-keys', { method: 'POST', body: { label: keyLabel } });
              setNewKey(r.key);
              setKeyLabel('');
              keys.reload();
            }}
          >
            Create key
          </ActionButton>
        </div>
      </Card>

      {adding && <AddMember onClose={() => setAdding(false)} onDone={() => (setAdding(false), toast('Team member added'), users.reload())} />}
    </>
  );
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'salesman', password: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title="Add a team member"
      onClose={onClose}
      size="sm"
      footer={
        <ActionButton className="btn btn-primary" disabled={!f.name || !f.email || f.password.length < 10} onClick={async () => (await api('/api/settings/users', { method: 'POST', body: f }), onDone())}>
          Add member
        </ActionButton>
      }
    >
      <Field label="Name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
      <Field label="Email (used to sign in)"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Role">
        <select value={f.role} onChange={set('role')}>
          <option value="salesman">Salesman: collections and visits only</option>
          <option value="accountant">Accountant: bills, entries and reports</option>
        </select>
      </Field>
      <Field label="Temporary password" hint="At least 10 characters. Ask them to keep it safe."><input type="password" value={f.password} onChange={set('password')} /></Field>
    </Modal>
  );
}
