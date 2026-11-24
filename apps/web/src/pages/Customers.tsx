import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CustomerSummary } from '../api';
import { useAuth } from '../auth';
import { AsyncForm, ErrorNote, RiskBadge } from '../components';
import { rupees } from '../format';
import { useApi } from '../hooks';

export function Customers() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { data, error, loading, reload } = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const staff = user?.role !== 'salesman';
  const list = (data?.customers ?? []).filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search),
  );

  return (
    <>
      <div className="pagehead">
        <h1>Customers</h1>
        {staff && <button onClick={() => setShowNew((s) => !s)}>{showNew ? 'Cancel' : 'Add customer'}</button>}
      </div>

      {showNew && (
        <section className="card">
          <AsyncForm
            className="form grid"
            submitLabel="Add customer"
            onSubmit={async (f) => {
              await api('/api/customers', {
                method: 'POST',
                body: {
                  name: f.get('name'),
                  phone: f.get('phone'),
                  gstin: f.get('gstin') || null,
                  credit_limit: f.get('credit_limit') || '0',
                  credit_days: Number(f.get('credit_days') || 30),
                  language: f.get('language'),
                },
              });
              setShowNew(false);
              reload();
            }}
          >
            <label>
              Shop name <input name="name" required />
            </label>
            <label>
              WhatsApp number <input name="phone" inputMode="tel" placeholder="98765 43210" required />
            </label>
            <label>
              GSTIN (optional) <input name="gstin" />
            </label>
            <label>
              Credit limit (₹) <input name="credit_limit" inputMode="decimal" placeholder="0 = no limit" />
            </label>
            <label>
              Credit days <input name="credit_days" type="number" min={0} max={365} defaultValue={30} />
            </label>
            <label>
              Message language
              <select name="language" defaultValue="en">
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
          </AsyncForm>
        </section>
      )}

      <input className="search" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ErrorNote error={error} />
      {loading && !data ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Balance</th>
              <th className="num">Overdue</th>
              <th>Risk</th>
              <th className="num">Tally</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/customers/${c.id}`}>{c.name}</Link>
                  <div className="muted small">+{c.phone}</div>
                </td>
                <td className="num">{rupees(c.balance_paise)}</td>
                <td className={`num ${c.overdue_paise > 0 ? 'bad' : ''}`}>{rupees(c.overdue_paise)}</td>
                <td>
                  <RiskBadge flag={c.risk.flag} title={c.risk.reasons.join('\n')} />
                </td>
                <td className={`num small ${c.tally_balance_paise != null && c.tally_balance_paise !== c.balance_paise ? 'warn' : 'muted'}`}>
                  {c.tally_balance_paise == null ? '—' : rupees(c.tally_balance_paise)}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </>
  );
}
