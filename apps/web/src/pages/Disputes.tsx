import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Dispute } from '../api';
import { AsyncForm, ErrorNote } from '../components';
import { date, REASON_LABEL, rupees } from '../format';
import { useApi } from '../hooks';

export function Disputes() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useApi<{ disputes: Dispute[] }>(`/api/disputes?status=${status}`);

  return (
    <>
      <div className="pagehead">
        <h1>Disputes</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      <p className="muted">Retailers raise these from their statement link. Resolve them before the due date so payments don't get stuck.</p>
      <ErrorNote error={error} />
      {(data?.disputes ?? []).length === 0 && <p className="muted">No disputes here.</p>}
      {(data?.disputes ?? []).map((d) => (
        <section className="card" key={d.id}>
          <div className="cardhead">
            <h2>
              <Link to={`/customers/${d.customer_id}`}>{d.customer_name}</Link> · {REASON_LABEL[d.reason] ?? d.reason}
            </h2>
            <span className="muted small">
              {d.raised_by === 'retailer' ? 'Raised by retailer' : 'Raised by staff'} · {date(d.created_at)}
            </span>
          </div>
          {d.entry_reference !== undefined && d.entry_id && (
            <p className="small">
              On {d.entry_reference ?? 'entry'} of {rupees(d.entry_amount_paise ?? 0)} dated {date(d.entry_date)}
            </p>
          )}
          {d.message && <p>“{d.message}”</p>}
          {d.status === 'open' ? (
            <AsyncForm
              className="form grid"
              submitLabel="Save decision"
              onSubmit={async (f) => {
                await api(`/api/disputes/${d.id}/resolve`, {
                  method: 'POST',
                  body: { status: f.get('status'), resolution_note: f.get('resolution_note') },
                });
                reload();
              }}
            >
              <label>
                Decision
                <select name="status" defaultValue="resolved">
                  <option value="resolved">Resolved (correction posted)</option>
                  <option value="rejected">Rejected (ledger is correct)</option>
                </select>
              </label>
              <label className="wide">
                Note for the record <input name="resolution_note" required placeholder="e.g. Credit note CN-12 issued" />
              </label>
            </AsyncForm>
          ) : (
            <p className="small">
              <b>{d.status}</b>: {d.resolution_note}
            </p>
          )}
        </section>
      ))}
      <ErrorNote error={null} />
    </>
  );
}
