import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Aging, type StatementLine } from '../api';
import { AsyncForm, ErrorNote } from '../components';
import { AgingBar } from '../ui';
import { date, KIND_LABEL, REASON_LABEL, rupees } from '../format';
import { useApi } from '../hooks';

interface PublicStatement {
  business_name: string;
  customer_name: string;
  as_of: string;
  balance_paise: number;
  overdue_paise: number;
  aging: Aging;
  lines: StatementLine[];
  disputes: Array<{ id: string; entry_id: string | null; reason: string; status: string; resolution_note: string | null; created_at: string }>;
  upi_link: string | null;
  upi_qr_svg: string | null;
  pay_amount_paise: number;
}

/** Retailer-facing statement, opened from the WhatsApp link. No login. */
export function Statement() {
  const { token } = useParams();
  const { data, error, reload } = useApi<PublicStatement>(`/api/public/statement/${token}`, false);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  if (error) return <div className="public"><ErrorNote error={error} /></div>;
  if (!data) return <div className="public">Loading…</div>;

  const disputedEntries = new Set(data.disputes.filter((d) => d.status === 'open').map((d) => d.entry_id));

  return (
    <div className="public">
      <div className="public-brand"><div className="brand-mark">₹</div><span>{data.business_name}</span></div>
      <h1>Your account statement</h1>
      <p className="muted">
        For <b>{data.customer_name}</b> as of {date(data.as_of)}
      </p>
      <div className="kpi-grid kpi-grid-2">
        <div className="kpi kpi-brand"><div className="kpi-label">You owe</div><div className="kpi-value">{rupees(data.balance_paise)}</div></div>
        <div className="kpi kpi-bad"><div className="kpi-label">Overdue now</div><div className="kpi-value">{rupees(data.overdue_paise)}</div></div>
      </div>

      {data.upi_link && (
        <div className="pay-card">
          <a className="paybutton" href={data.upi_link}>
            Pay {rupees(data.pay_amount_paise)} with any UPI app
          </a>
          {data.upi_qr_svg && (
            <div className="pay-qr">
              <div className="qr" dangerouslySetInnerHTML={{ __html: data.upi_qr_svg }} />
              <span className="muted small">On a computer? Scan this with your phone.</span>
            </div>
          )}
        </div>
      )}
      <div className="card"><AgingBar aging={data.aging} /></div>

      {thanks && <p className="note">Thank you. Your supplier will review this and reply.</p>}

      <h2>Bills and payments</h2>
      <p className="muted small">Something wrong? Tap “Report a problem” on that line.</p>
      <div className="card card-flush"><div className="table-wrap"><table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Details</th>
            <th className="num">Amount</th>
            <th className="num">Balance</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...data.lines].reverse().map((l) => (
            <tr key={l.id}>
              <td>{date(l.entry_date)}</td>
              <td>
                {KIND_LABEL[l.kind] ?? l.kind} {l.reference ?? ''}
                {l.due_date && l.debit_paise > 0 && <div className="muted small">Due {date(l.due_date)}</div>}
              </td>
              <td className="num">{l.debit_paise ? rupees(l.debit_paise) : `−${rupees(l.credit_paise)}`}</td>
              <td className="num">{rupees(l.running_balance_paise)}</td>
              <td>
                {disputedEntries.has(l.id) ? (
                  <span className="small muted">Reported</span>
                ) : (
                  <button className="link" onClick={() => setDisputeFor(l.id)}>
                    Report a problem
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {disputeFor && (
        <section className="card">
          <h2>Report a problem</h2>
          <AsyncForm
            submitLabel="Send to supplier"
            onSubmit={async (f) => {
              await api(`/api/public/statement/${token}/disputes`, {
                method: 'POST',
                auth: false,
                body: { entry_id: disputeFor, reason: f.get('reason'), message: f.get('message') || undefined },
              });
              setDisputeFor(null);
              setThanks(true);
              reload();
            }}
          >
            <label>
              What's wrong?
              <select name="reason" defaultValue="amount_wrong">
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Details (optional) <textarea name="message" maxLength={1000} rows={3} />
            </label>
          </AsyncForm>
          <button className="link" onClick={() => setDisputeFor(null)}>
            Cancel
          </button>
        </section>
      )}

      {data.disputes.length > 0 && (
        <>
          <h2>Your reported problems</h2>
          <ul className="plain">
            {data.disputes.map((d) => (
              <li key={d.id}>
                {REASON_LABEL[d.reason] ?? d.reason} · <b>{d.status}</b> · {date(d.created_at)}
                {d.resolution_note && <div className="small">Reply: {d.resolution_note}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
