import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowLeft, Copy, FileText, MapPin, MessageCircle, Navigation, Pencil, Phone, Plus, Printer, QrCode, Send, User,
} from 'lucide-react';
import type { CustomerDetail as Detail } from '@credit-ledger/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { date, dateTime, KIND_LABEL, MODE_LABEL, OUTCOME_LABEL, phone, REASON_LABEL, rupees, todayIso } from '../format';
import { useApi } from '../hooks';
import {
  ActionButton, AgingBar, Avatar, Card, Empty, ErrorNote, Field, Kpi, Loading, Modal, Money, PageHeader, Pill, Progress, RiskBadge, Tabs, useToast,
} from '../ui';
import { CustomerForm, type Beat } from './CustomerForm';

type Tab = 'statement' | 'bills' | 'visits' | 'activity';

export function CustomerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/customers/${id}`);
  const beats = useApi<{ beats: Beat[] }>(staff ? '/api/beats' : null);
  const [tab, setTab] = useState<Tab>('statement');
  const [editing, setEditing] = useState(false);
  const [entryKind, setEntryKind] = useState<string | null>(null);
  const [qr, setQr] = useState<{ svg: string; link: string; amount_paise: number; vpa: string } | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const c = data.customer;
  const limitUsed = c.credit_limit_paise > 0 ? Math.round((data.balance_paise / c.credit_limit_paise) * 100) : null;

  const statementLink = async () => (await api<{ url: string }>(`/api/customers/${id}/statement-link`, { method: 'POST' })).url;

  return (
    <>
      <PageHeader
        back={<Link to="/customers" className="back"><ArrowLeft size={15} />Customers</Link>}
        title={
          <span className="title-with-avatar">
            <Avatar name={c.name} size={44} />
            <span>
              {c.name}
              {c.archived_at && <Pill>Archived</Pill>}
            </span>
          </span>
        }
        subtitle={
          <span className="meta-row">
            {c.contact_name && <span><User size={14} />{c.contact_name}</span>}
            <a href={`tel:+${c.phone}`}><Phone size={14} />{phone(c.phone)}</a>
            {c.area && <span><MapPin size={14} />{c.area}</span>}
            {data.beat && <span><Navigation size={14} />{data.beat.name}</span>}
            {c.gstin && <span>GSTIN {c.gstin}</span>}
            {c.tags.map((t) => <Pill key={t}>#{t}</Pill>)}
          </span>
        }
        actions={
          <>
            {staff && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
            {staff && <button className="btn btn-primary" onClick={() => nav(`/bills/new?customer=${c.id}`)}><FileText size={15} />New bill</button>}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Balance" value={rupees(data.balance_paise)} tone="brand" sub={`${c.credit_days} days credit`} />
        <Kpi
          label="Overdue"
          value={rupees(c.overdue_paise)}
          tone={c.overdue_paise > 0 ? 'bad' : 'good'}
          sub={data.risk.max_days_overdue ? `Oldest ${data.risk.max_days_overdue} days` : 'Nothing overdue'}
        />
        <Kpi
          label="Credit limit"
          value={c.credit_limit_paise ? rupees(c.credit_limit_paise) : 'No limit'}
          sub={limitUsed !== null ? <><Progress value={data.balance_paise} max={c.credit_limit_paise} tone={limitUsed > 100 ? 'bad' : limitUsed > 80 ? 'warn' : 'good'} />{limitUsed}% used</> : undefined}
        />
        <Kpi label="Risk" value={<RiskBadge flag={data.risk.flag} />} sub={data.risk.reasons.join(' · ') || 'Pays on time'} />
      </div>

      <div className="quick-actions">
        {staff && (
          <>
            <button className="qa" onClick={() => setEntryKind('payment')}><Plus size={18} /><span>Record payment</span></button>
            <button className="qa" onClick={() => setEntryKind('invoice')}><FileText size={18} /><span>Add entry</span></button>
            <ActionButton
              className="qa"
              onClick={async () => {
                await api(`/api/reminders/customers/${id}`, { method: 'POST' });
                reload();
              }}
              okText="Reminder sent on WhatsApp"
            >
              <Send size={18} /><span>WhatsApp reminder</span>
            </ActionButton>
          </>
        )}
        <ActionButton
          className="qa"
          onClick={async () => {
            const url = await statementLink();
            await navigator.clipboard.writeText(url).catch(() => undefined);
          }}
          okText="Statement link copied"
        >
          <Copy size={18} /><span>Copy statement link</span>
        </ActionButton>
        <ActionButton
          className="qa"
          onClick={async () => {
            const url = await statementLink();
            const text = `Namaste${c.contact_name ? ` ${c.contact_name} ji` : ''}, your account statement: ${url}`;
            window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
          }}
        >
          <MessageCircle size={18} /><span>Share on WhatsApp</span>
        </ActionButton>
        <ActionButton className="qa" onClick={async () => setQr(await api(`/api/customers/${id}/upi-qr`))}><QrCode size={18} /><span>UPI QR</span></ActionButton>
        <button className="qa" onClick={() => window.print()}><Printer size={18} /><span>Print statement</span></button>
        {c.lat !== null && c.lng !== null && (
          <a className="qa" href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">
            <Navigation size={18} /><span>Directions</span>
          </a>
        )}
      </div>

      <Card title="Receivables by age"><AgingBar aging={data.aging} /></Card>

      <Card pad={false}>
        <div className="card-tabs">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'statement', label: 'Statement', count: data.statement.length },
              { id: 'bills', label: 'Bills', count: data.bills.length },
              { id: 'visits', label: 'Visits', count: data.visits.length },
              { id: 'activity', label: 'Disputes & promises', count: data.disputes.length + data.promises.length },
            ]}
          />
        </div>
        {tab === 'statement' && (
          data.statement.length === 0 ? <Empty title="No entries yet" /> : (
            <div className="table-wrap print-area">
              <div className="print-only print-title"><h2>{c.name}: statement as of {date(todayIso())}</h2></div>
              <table className="table">
                <thead><tr><th>Date</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {[...data.statement].reverse().map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{date(l.entry_date)}</td>
                      <td>
                        <b className="weight-500">{KIND_LABEL[l.kind] ?? l.kind}</b>
                        {l.payment_mode && <Pill tone="green">{MODE_LABEL[l.payment_mode]}</Pill>}
                        <span className="cell-sub">{[l.reference, l.payment_ref, l.note].filter(Boolean).join(' · ')}{l.due_date && l.debit_paise > 0 ? ` · due ${date(l.due_date)}` : ''}</span>
                      </td>
                      <td className="num">{l.debit_paise ? <Money paise={l.debit_paise} /> : ''}</td>
                      <td className="num">{l.credit_paise ? <Money paise={l.credit_paise} tone="good" /> : ''}</td>
                      <td className="num"><Money paise={l.running_balance_paise} strong /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab === 'bills' && (
          data.bills.length === 0 ? (
            <Empty title="No bills yet">{staff && <button className="btn btn-primary" onClick={() => nav(`/bills/new?customer=${c.id}`)}><FileText size={15} />Create a bill</button>}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bill</th><th>Date</th><th>Due</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {data.bills.map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => nav(`/bills/${b.id}`)}>
                      <td><b>{b.bill_no}</b></td>
                      <td>{date(b.bill_date)}</td>
                      <td>{date(b.due_date)}</td>
                      <td className="num"><Money paise={b.total_paise} strong /></td>
                      <td>{b.cancelled_at && <Pill tone="red">Cancelled</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab === 'visits' && (
          data.visits.length === 0 ? <Empty title="No visits yet">Salesmen check in from the mobile app.</Empty> : (
            <div className="list">
              {data.visits.map((v) => (
                <div key={v.id} className="list-row">
                  <div className="list-main">
                    <b>{OUTCOME_LABEL[v.outcome] ?? v.outcome}</b>
                    <span>{v.salesman_name} · {dateTime(v.created_at)}{v.note ? ` · “${v.note}”` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {tab === 'activity' && (
          <div className="list">
            {data.disputes.map((d) => (
              <div key={d.id} className="list-row">
                <div className="list-main">
                  <b>{REASON_LABEL[d.reason] ?? d.reason}</b>
                  <span>{date(d.created_at)}{d.message ? ` · “${d.message}”` : ''}{d.resolution_note ? ` · ${d.resolution_note}` : ''}</span>
                </div>
                <Pill tone={d.status === 'open' ? 'amber' : d.status === 'resolved' ? 'green' : 'neutral'}>{d.status}</Pill>
              </div>
            ))}
            {data.promises.map((p) => (
              <div key={p.id} className="list-row">
                <div className="list-main">
                  <b>Promised {p.amount_paise ? rupees(p.amount_paise) : 'payment'} by {date(p.promised_date)}</b>
                  <span>“{p.source_text}”</span>
                </div>
                <Pill tone={p.status === 'kept' ? 'green' : p.status === 'broken' ? 'red' : 'amber'}>{p.status}</Pill>
              </div>
            ))}
            {data.reminders.map((r) => (
              <div key={r.id} className="list-row">
                <div className="list-main">
                  <b>Reminder for {rupees(r.amount_paise)}</b>
                  <span>{dateTime(r.created_at)}{r.error ? ` · ${r.error}` : ''}</span>
                </div>
                <Pill tone={r.status === 'sent' ? 'blue' : 'red'}>{r.status}</Pill>
              </div>
            ))}
            {data.disputes.length + data.promises.length + data.reminders.length === 0 && <Empty title="Nothing here yet" />}
          </div>
        )}
      </Card>

      {staff && (
        <div className="danger-zone">
          {!c.archived_at ? (
            <ActionButton
              className="btn btn-ghost"
              onClick={async () => {
                await api(`/api/customers/${id}`, { method: 'PATCH', body: { archived: true } });
                reload();
              }}
              okText="Customer archived"
              title="Hide from lists (only when the balance is zero)"
            >
              <Archive size={15} />Archive customer
            </ActionButton>
          ) : (
            <ActionButton className="btn btn-ghost" onClick={async () => (await api(`/api/customers/${id}`, { method: 'PATCH', body: { archived: false } }), reload())} okText="Customer restored">
              <Archive size={15} />Restore customer
            </ActionButton>
          )}
        </div>
      )}

      {editing && (
        <CustomerForm
          customer={c}
          beats={beats.data?.beats ?? []}
          areas={[]}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast('Saved');
            reload();
          }}
        />
      )}
      {entryKind && <EntryModal customerId={c.id} initialKind={entryKind} onClose={() => setEntryKind(null)} onSaved={() => (setEntryKind(null), toast('Entry posted'), reload())} />}
      {qr && (
        <Modal title="Scan to pay with any UPI app" onClose={() => setQr(null)} size="sm">
          <div className="qr-block">
            <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <b className="qr-amount">{rupees(qr.amount_paise)}</b>
            <span className="muted">to {qr.vpa}</span>
            <p className="muted small">Show this to the shop owner. The money goes straight to your bank account.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function EntryModal({ customerId, initialKind, onClose, onSaved }: { customerId: string; initialKind: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(initialKind);
  const [f, setF] = useState({ amount: '', entry_date: todayIso(), reference: '', note: '', payment_mode: 'upi', payment_ref: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/customers/${customerId}/entries`, {
        method: 'POST',
        body: {
          kind,
          amount: f.amount,
          entry_date: f.entry_date || undefined,
          reference: f.reference || undefined,
          note: f.note || undefined,
          payment_mode: kind === 'payment' ? f.payment_mode : undefined,
          payment_ref: kind === 'payment' ? f.payment_ref || undefined : undefined,
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === 'payment' ? 'Record a payment' : 'Post a ledger entry'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.amount} onClick={save}>{busy ? 'Saving…' : 'Post entry'}</button></>}
    >
      <form className="form-grid" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Amount (₹)"><input value={f.amount} onChange={set('amount')} inputMode="decimal" autoFocus required /></Field>
        <Field label="Date"><input type="date" value={f.entry_date} onChange={set('entry_date')} /></Field>
        <Field label="Bill / reference no."><input value={f.reference} onChange={set('reference')} /></Field>
        {kind === 'payment' && (
          <>
            <Field label="Mode">
              <select value={f.payment_mode} onChange={set('payment_mode')}>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </Field>
            <Field label="UTR / cheque no."><input value={f.payment_ref} onChange={set('payment_ref')} /></Field>
          </>
        )}
        <Field label={`Note${kind.startsWith('adjustment') ? ' (required)' : ''}`} span={2}><input value={f.note} onChange={set('note')} /></Field>
      </form>
      <p className="muted small">Entries can't be edited or deleted. To fix a mistake, post a credit note or adjustment.</p>
      <ErrorNote error={error} />
    </Modal>
  );
}
