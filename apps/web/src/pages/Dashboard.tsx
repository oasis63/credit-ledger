import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Aging, type Risk } from '../api';
import { AgingBar, ErrorNote, RiskBadge, Stat } from '../components';
import { date, rupees } from '../format';
import { useApi } from '../hooks';

interface DashboardData {
  as_of: string;
  receivable_paise: number;
  overdue_paise: number;
  aging: Aging;
  customers_with_balance: number;
  risk: { green: number; amber: number; red: number };
  open_disputes: number;
  cash_pending_handover_paise: number;
  promises_due: Array<{ id: string; customer_id: string; customer_name: string; promised_date: string; amount_paise: number | null }>;
  top_overdue: Array<{ id: string; name: string; overdue_paise: number; balance_paise: number; risk: Risk }>;
}

export function Dashboard() {
  const { data, error, loading, reload } = useApi<DashboardData>('/api/reports/dashboard');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remindAll() {
    setBusy(true);
    setBulkMsg(null);
    try {
      const r = await api<{ sent: number; failed: number; skipped_recently_reminded: number }>('/api/reminders/bulk', {
        method: 'POST',
        body: {},
      });
      setBulkMsg(`Sent ${r.sent} reminders${r.failed ? `, ${r.failed} failed` : ''}. Skipped ${r.skipped_recently_reminded} reminded in the last 3 days.`);
      reload();
    } catch (e) {
      setBulkMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <p>Loading…</p>;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  return (
    <>
      <div className="pagehead">
        <h1>Dashboard</h1>
        <span className="muted">As of {date(data.as_of)}</span>
      </div>
      <div className="stats">
        <Stat label="Total receivable" value={rupees(data.receivable_paise)} />
        <Stat label="Overdue" value={rupees(data.overdue_paise)} tone={data.overdue_paise > 0 ? 'bad' : undefined} />
        <Stat label="Cash with salesmen" value={rupees(data.cash_pending_handover_paise)} />
        <Stat label="Open disputes" value={<Link to="/disputes">{data.open_disputes}</Link>} />
        <Stat
          label="Customers by risk"
          value={
            <span className="risksplit">
              <RiskBadge flag="green" /> {data.risk.green} <RiskBadge flag="amber" /> {data.risk.amber} <RiskBadge flag="red" /> {data.risk.red}
            </span>
          }
        />
      </div>

      <section className="card">
        <h2>Receivables by age</h2>
        <AgingBar aging={data.aging} />
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>Most overdue customers</h2>
          <button onClick={remindAll} disabled={busy}>
            {busy ? 'Sending…' : 'Remind all overdue on WhatsApp'}
          </button>
        </div>
        {bulkMsg && <p className="note">{bulkMsg}</p>}
        {data.top_overdue.length === 0 ? (
          <p className="muted">Nothing overdue. </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Overdue</th>
                <th className="num">Balance</th>
                <th>Risk</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.top_overdue.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="num bad">{rupees(c.overdue_paise)}</td>
                  <td className="num">{rupees(c.balance_paise)}</td>
                  <td>
                    <RiskBadge flag={c.risk.flag} />
                  </td>
                  <td className="muted small">{c.risk.reasons.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Payment promises due</h2>
        {data.promises_due.length === 0 ? (
          <p className="muted">No promises due today or tomorrow.</p>
        ) : (
          <ul className="plain">
            {data.promises_due.map((p) => (
              <li key={p.id}>
                <Link to={`/customers/${p.customer_id}`}>{p.customer_name}</Link> promised {p.amount_paise ? rupees(p.amount_paise) : 'payment'} by{' '}
                {date(p.promised_date)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
