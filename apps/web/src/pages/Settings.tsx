import { useState } from 'react';
import { api } from '../api';
import { AsyncForm, ErrorNote } from '../components';
import { date } from '../format';
import { useApi } from '../hooks';

interface Tenant {
  id: string;
  name: string;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  wa_phone_number_id: string | null;
}

export function Settings() {
  const tenant = useApi<{ tenant: Tenant }>('/api/settings');
  const users = useApi<{ users: Array<{ id: string; name: string; email: string; role: string; active: boolean }> }>('/api/settings/users');
  const keys = useApi<{ keys: Array<{ id: string; label: string; last_used: string | null; created_at: string }> }>('/api/settings/agent-keys');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = tenant.data?.tenant;

  return (
    <>
      <h1>Settings</h1>
      <section className="card">
        <h2>Business and payments</h2>
        <ErrorNote error={tenant.error} />
        {t && (
          <AsyncForm
            key={t.id + (t.upi_vpa ?? '')}
            className="form grid"
            submitLabel="Save"
            onSubmit={async (f) => {
              await api('/api/settings', {
                method: 'PATCH',
                body: {
                  name: f.get('name'),
                  upi_vpa: f.get('upi_vpa') || null,
                  upi_payee_name: f.get('upi_payee_name') || null,
                  wa_phone_number_id: f.get('wa_phone_number_id') || null,
                },
              });
              setSaved(true);
              tenant.reload();
            }}
          >
            <label>
              Business name <input name="name" defaultValue={t.name} required />
            </label>
            <label>
              Your UPI ID (payments go straight here) <input name="upi_vpa" defaultValue={t.upi_vpa ?? ''} placeholder="shop@okhdfcbank" />
            </label>
            <label>
              Name shown in UPI apps <input name="upi_payee_name" defaultValue={t.upi_payee_name ?? ''} />
            </label>
            <label>
              WhatsApp phone number ID <input name="wa_phone_number_id" defaultValue={t.wa_phone_number_id ?? ''} placeholder="From Meta Business Manager" />
            </label>
          </AsyncForm>
        )}
        {saved && <p className="note">Saved.</p>}
      </section>

      <section className="card">
        <h2>Team</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.users ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  {u.role === 'owner' ? (
                    'active'
                  ) : (
                    <button
                      className="link"
                      onClick={async () => {
                        await api(`/api/settings/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
                        users.reload();
                      }}
                    >
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Add a team member</h3>
        <AsyncForm
          className="form grid"
          submitLabel="Add"
          onSubmit={async (f) => {
            await api('/api/settings/users', {
              method: 'POST',
              body: { name: f.get('name'), email: f.get('email'), role: f.get('role'), password: f.get('password') },
            });
            users.reload();
          }}
        >
          <label>
            Name <input name="name" required />
          </label>
          <label>
            Email <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role" defaultValue="salesman">
              <option value="salesman">Salesman (collections only)</option>
              <option value="accountant">Accountant</option>
            </select>
          </label>
          <label>
            Temporary password <input name="password" type="password" minLength={10} required />
          </label>
        </AsyncForm>
      </section>

      <section className="card">
        <h2>Tally sync agent keys</h2>
        <p className="muted small">Install the sync agent on the PC that runs Tally and give it one of these keys. It only reads from Tally.</p>
        {newKey && (
          <p className="note">
            Copy this key now; it won't be shown again: <code>{newKey}</code>
          </p>
        )}
        <ul className="plain">
          {(keys.data?.keys ?? []).map((k) => (
            <li key={k.id}>
              {k.label} · created {date(k.created_at)} · last used {k.last_used ? date(k.last_used) : 'never'}{' '}
              <button
                className="link"
                onClick={async () => {
                  await api(`/api/settings/agent-keys/${k.id}`, { method: 'DELETE' });
                  keys.reload();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
        <AsyncForm
          className="inline"
          submitLabel="Create key"
          onSubmit={async (f) => {
            const r = await api<{ key: string }>('/api/settings/agent-keys', { method: 'POST', body: { label: f.get('label') } });
            setNewKey(r.key);
            keys.reload();
          }}
        >
          <input name="label" placeholder="e.g. Office PC" required />
        </AsyncForm>
      </section>
    </>
  );
}
