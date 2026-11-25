import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { api, type Dispute } from '../api';
import { date, REASON_LABEL, rupees } from '../format';
import { useApi } from '../hooks';
import { ActionButton, Avatar, Empty, ErrorNote, Field, Loading, PageHeader, Pill, Tabs } from '../ui';

export function Disputes() {
  const [status, setStatus] = useState<'open' | 'resolved' | 'rejected' | 'all'>('open');
  const { data, error, loading, reload } = useApi<{ disputes: Dispute[] }>(`/api/disputes?status=${status}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <>
      <PageHeader title="Disputes" subtitle="Problems retailers report from their statement link. Sort them out before the due date so payments don't get stuck." />
      <Tabs value={status} onChange={setStatus} tabs={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} />
      <div className="tab-body">
        <ErrorNote error={error} />
        {loading && !data ? <Loading /> : (data?.disputes ?? []).length === 0 ? (
          <Empty title={status === 'open' ? 'No open disputes' : 'Nothing here'} icon={status === 'open' ? <CheckCircle2 size={22} /> : <MessageSquareWarning size={22} />} />
        ) : (
          <div className="stack">
            {data!.disputes.map((d) => (
              <div className="card dispute" key={d.id}>
                <div className="dispute-head">
                  <span className="with-icon">
                    <Avatar name={d.customer_name ?? '?'} size={34} />
                    <span>
                      <Link to={`/customers/${d.customer_id}`}><b>{d.customer_name}</b></Link>
                      <span className="cell-sub">{d.raised_by === 'retailer' ? 'Raised by the retailer' : 'Raised by staff'} · {date(d.created_at)}</span>
                    </span>
                  </span>
                  <Pill tone={d.status === 'open' ? 'amber' : d.status === 'resolved' ? 'green' : 'neutral'}>{d.status}</Pill>
                </div>
                <div className="dispute-body">
                  <b>{REASON_LABEL[d.reason] ?? d.reason}</b>
                  {d.entry_id && d.entry_reference !== undefined && (
                    <span className="muted"> on {d.entry_reference ?? 'an entry'} of {rupees(d.entry_amount_paise ?? 0)} dated {date(d.entry_date)}</span>
                  )}
                  {d.message && <blockquote>“{d.message}”</blockquote>}
                </div>
                {d.status === 'open' ? (
                  <div className="dispute-actions">
                    <Field label="Note for the record">
                      <input value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} placeholder="e.g. Credit note CN-12 issued" />
                    </Field>
                    <div className="row-gap">
                      {(['resolved', 'rejected'] as const).map((s) => (
                        <ActionButton
                          key={s}
                          className={`btn ${s === 'resolved' ? 'btn-primary' : ''}`}
                          disabled={!notes[d.id]?.trim()}
                          onClick={async () => {
                            await api(`/api/disputes/${d.id}/resolve`, { method: 'POST', body: { status: s, resolution_note: notes[d.id] } });
                            reload();
                          }}
                          okText={s === 'resolved' ? 'Marked resolved' : 'Marked rejected'}
                        >
                          {s === 'resolved' ? 'Resolve (correction posted)' : 'Reject (ledger is right)'}
                        </ActionButton>
                      ))}
                    </div>
                  </div>
                ) : (
                  d.resolution_note && <p className="muted small">Reply: {d.resolution_note}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
