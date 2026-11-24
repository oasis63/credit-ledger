import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Aging, type CustomerSummary, type Dispute, type Risk, type StatementLine } from '../api';
import { useAuth } from '../auth';
import { AgingBar, AsyncForm, ErrorNote, RiskBadge, Stat } from '../components';
import { date, KIND_LABEL, REASON_LABEL, rupees } from '../format';
import { useApi } from '../hooks';

interface Detail {
  customer: CustomerSummary;
  balance_paise: number;
  aging: Aging;
  statement: StatementLine[];
  risk: Risk;
  disputes: Dispute[];
  promises: Array<{ id: string; promised_date: string; amount_paise: number | null; source_text: string; status: string }>;
  reminders: Array<{ id: string; created_at: string; amount_paise: number; status: string; error: string | null }>;
}

export function CustomerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const { data, error, loading, reload } = useApi<Detail>(`/api/customers/${id}`);
  const [kind, setKind] = useState('invoice');
  const [flash, setFlash] = useState<string | null>(null);

  if (loading && !data) return <p>Loading…</p>;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const c = data.customer;

  async function remind() {
    setFlash(null);
    try {
      await api(`/api/reminders/customers/${id}`, { method: 'POST' });
      setFlash('Reminder sent on WhatsApp.');
      reload();
    } catch (e) {
      setFlash((e as Error).message);
    }
  }

  async function copyLink() {
    setFlash(null);
    try {
      const r = await api<{ url: string }>(`/api/customers/${id}/statement-link`, { method: 'POST' });
      await navigator.clipboard.writeText(r.url).catch(() => undefined);
      setFlash(`Statement link copied: ${r.url}`);
    } catch (e) {
      setFlash((e as Error).message);
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{c.name}</h1>
          <span className="muted">
            +{c.phone} {c.gstin ? `· GSTIN ${c.gstin}` : ''} · {c.credit_days} days credit
          </span>
        </div>
        {staff && (
          <div className="actions">
            <button onClick={remind}>Send WhatsApp reminder</button>
            <button className="secondary" onClick={copyLink}>
              Copy statement link
            </button>
          </div>
        )}
      </div>
      {flash && <p className="note">{flash}</p>}

      <div className="stats">
        <Stat label="Balance" value={rupees(data.balance_paise)} />
        <Stat label="Credit limit" value={c.credit_limit_paise ? rupees(c.credit_limit_paise) : 'No limit'} />
        <Stat label="Oldest overdue" value={data.risk.max_days_overdue ? `${data.risk.max_days_overdue} days` : 'None'} />
        <Stat label="Risk" value={<RiskBadge flag={data.risk.flag} />} />
      </div>
      {data.risk.reasons.length > 0 && <p className="muted">Why: {data.risk.reasons.join(' · ')}</p>}

      <section className="card">
        <AgingBar aging={data.aging} />
      </section>

      {staff && (
        <section className="card">
          <h2>Post an entry</h2>
          <AsyncForm
            className="form grid"
            submitLabel="Post entry"
            onSubmit={async (f) => {
              await api(`/api/customers/${id}/entries`, {
                method: 'POST',
                body: {
                  kind: f.get('kind'),
                  amount: f.get('amount'),
                  entry_date: f.get('entry_date') || undefined,
                  reference: f.get('reference') || undefined,
                  note: f.get('note') || undefined,
                  payment_mode: f.get('kind') === 'payment' ? f.get('payment_mode') : undefined,
                  payment_ref: f.get('payment_ref') || undefined,
                },
              });
              reload();
            }}
          >
            <label>
              Type
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (₹) <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              Date <input name="entry_date" type="date" />
            </label>
            <label>
              Bill / reference no. <input name="reference" />
            </label>
            {kind === 'payment' && (
              <>
                <label>
                  Mode
                  <select name="payment_mode" defaultValue="bank">
                    <option value="bank">Bank transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </label>
                <label>
                  UTR / cheque no. <input name="payment_ref" />
                </label>
              </>
            )}
            <label className="wide">
              Note {kind.startsWith('adjustment') ? '(required)' : ''} <input name="note" />
            </label>
          </AsyncForm>
          <p className="muted small">Entries can't be edited or deleted. To correct a mistake, post a credit note or adjustment.</p>
        </section>
      )}

      <section className="card">
        <h2>Statement</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Ref</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {[...data.statement].reverse().map((l) => (
              <tr key={l.id}>
                <td>{date(l.entry_date)}</td>
                <td>
                  {KIND_LABEL[l.kind] ?? l.kind}
                  {l.payment_mode ? <span className="muted small"> · {l.payment_mode}</span> : null}
                </td>
                <td className="small">{l.reference ?? l.payment_ref ?? ''}</td>
                <td className="num">{l.debit_paise ? rupees(l.debit_paise) : ''}</td>
                <td className="num">{l.credit_paise ? rupees(l.credit_paise) : ''}</td>
                <td className="num">{rupees(l.running_balance_paise)}</td>
              </tr>
            ))}
            {data.statement.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="twocol">
        <section className="card">
          <h2>Disputes</h2>
          {data.disputes.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="plain">
              {data.disputes.map((d) => (
                <li key={d.id}>
                  <b>{REASON_LABEL[d.reason] ?? d.reason}</b> · {d.status} · {date(d.created_at)}
                  {d.message && <div className="small">“{d.message}”</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Promises and reminders</h2>
          <ul className="plain">
            {data.promises.map((p) => (
              <li key={p.id}>
                Promised {p.amount_paise ? rupees(p.amount_paise) : 'payment'} by {date(p.promised_date)} · <b>{p.status}</b>
                <div className="small muted">“{p.source_text}”</div>
              </li>
            ))}
            {data.reminders.map((r) => (
              <li key={r.id} className="small">
                Reminder {r.status} for {rupees(r.amount_paise)} on {date(r.created_at)} {r.error ? `(${r.error})` : ''}
              </li>
            ))}
            {data.promises.length + data.reminders.length === 0 && <li className="muted">Nothing yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
