import { useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Clock, Receipt } from 'lucide-react';
import { api, type CustomerSummary } from '../api';
import { useAuth } from '../auth';
import { date, MODE_LABEL, rupees, todayIso } from '../format';
import { useApi } from '../hooks';
import { ActionButton, Avatar, Card, Empty, ErrorNote, Field, Kpi, Money, PageHeader, Pill, useToast } from '../ui';

interface Pending { salesman_id: string; salesman_name: string; entry_count: number; total_paise: number; cash_paise: number; cheque_paise: number }
interface Entry { id: string; customer_id: string; amount_paise: number; payment_mode: string; payment_ref: string | null; entry_date: string; created_at: string }

export function Collections() {
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const toast = useToast();
  const customers = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const pending = useApi<{ pending: Pending[] }>('/api/collections/pending');
  const closes = useApi<{ day_closes: Array<Record<string, string | number>> }>(staff ? '/api/collections/day-closes' : null);
  const today = todayIso();
  const recent = useApi<{ entries: Array<Entry & { kind: string }> }>(`/api/entries?from=${today}&to=${today}&limit=200`);
  const [f, setF] = useState({ customer_id: '', amount: '', payment_mode: 'cash', payment_ref: '', note: '' });
  const [declared, setDeclared] = useState<Record<string, string>>({});
  const [last, setLast] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const names = useMemo(() => new Map((customers.data?.customers ?? []).map((c) => [c.id, c.name])), [customers.data]);
  const todays = (recent.data?.entries ?? []).filter((e) => e.kind === 'payment');
  const chosen = customers.data?.customers.find((c) => c.id === f.customer_id);
  const totalPending = (pending.data?.pending ?? []).reduce((s, p) => s + p.cash_paise + p.cheque_paise, 0);

  return (
    <>
      <PageHeader title="Collections" subtitle="Money collected in the field. Every payment sends the shop an instant WhatsApp receipt." />
      <div className="kpi-grid kpi-grid-3">
        <Kpi label="Collected today" value={rupees(todays.reduce((s, e) => s + e.amount_paise, 0))} sub={`${todays.length} payments`} icon={<Banknote size={18} />} tone="good" />
        <Kpi label="Not yet handed over" value={rupees(totalPending)} sub="Cash and cheques with salesmen" icon={<Clock size={18} />} tone={totalPending ? 'warn' : undefined} />
        <Kpi label="Day closes" value={(closes.data?.day_closes ?? []).length} sub="Recent" icon={<CheckCircle2 size={18} />} />
      </div>

      <div className="grid-2">
        <Card title="Record a collection">
          {last && <div className="alert alert-ok"><Receipt size={16} />{last}</div>}
          <form
            className="form-grid"
            onSubmit={(e) => e.preventDefault()}
          >
            <Field label="Customer" span={2}>
              <select value={f.customer_id} onChange={set('customer_id')} required>
                <option value="">Choose a shop…</option>
                {(customers.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · owes {rupees(c.balance_paise)}</option>)}
              </select>
            </Field>
            {chosen && chosen.overdue_paise > 0 && (
              <div className="span-2 hint-row">Overdue <b className="neg">{rupees(chosen.overdue_paise)}</b> <button type="button" className="chip" onClick={() => setF((x) => ({ ...x, amount: String(chosen.overdue_paise / 100) }))}>Use this amount</button></div>
            )}
            <Field label="Amount (₹)"><input value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="0" required /></Field>
            <Field label="Mode">
              <div className="seg-control">
                {(['cash', 'upi', 'cheque'] as const).map((m) => (
                  <button type="button" key={m} className={f.payment_mode === m ? 'on' : ''} onClick={() => setF((x) => ({ ...x, payment_mode: m }))}>{MODE_LABEL[m]}</button>
                ))}
              </div>
            </Field>
            {f.payment_mode !== 'cash' && (
              <Field label={f.payment_mode === 'cheque' ? 'Cheque number' : 'UPI reference (UTR)'} span={2}><input value={f.payment_ref} onChange={set('payment_ref')} required /></Field>
            )}
            <Field label="Note" span={2}><input value={f.note} onChange={set('note')} /></Field>
          </form>
          <ActionButton
            className="btn btn-primary btn-block"
            disabled={!f.customer_id || !f.amount}
            onClick={async () => {
              const r = await api<{ receipt: { number: string; sent: boolean; error: string | null } }>('/api/collections', {
                method: 'POST',
                body: { customer_id: f.customer_id, amount: f.amount, payment_mode: f.payment_mode, payment_ref: f.payment_ref || undefined, note: f.note || undefined },
              });
              setLast(r.receipt.sent ? `Receipt #${r.receipt.number} sent on WhatsApp.` : `Saved as receipt #${r.receipt.number}. WhatsApp failed: ${r.receipt.error}`);
              setF({ customer_id: '', amount: '', payment_mode: 'cash', payment_ref: '', note: '' });
              pending.reload();
              recent.reload();
              customers.reload();
            }}
          >
            Record and send receipt
          </ActionButton>
        </Card>

        <Card title="Today's payments" pad={false}>
          {todays.length === 0 ? <Empty title="No payments yet today" /> : (
            <div className="list">
              {todays.map((e) => (
                <div key={e.id} className="list-row">
                  <Avatar name={names.get(e.customer_id) ?? '?'} size={32} />
                  <div className="list-main">
                    <b>{names.get(e.customer_id) ?? 'Customer'}</b>
                    <span>{new Date(e.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{e.payment_ref ? ` · ${e.payment_ref}` : ''}</span>
                  </div>
                  <div className="list-end"><Money paise={e.amount_paise} tone="good" strong /><Pill tone="green">{MODE_LABEL[e.payment_mode] ?? e.payment_mode}</Pill></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Cash and cheques not yet handed over" pad={false}>
        <ErrorNote error={pending.error} />
        {(pending.data?.pending ?? []).length === 0 ? <Empty title="Nothing pending" icon={<CheckCircle2 size={22} />}>Every rupee collected has been handed in.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Salesman</th><th className="num">Payments</th><th className="num">Cash</th><th className="num">Cheques</th>{staff && <th>Close the day</th>}</tr></thead>
              <tbody>
                {pending.data!.pending.map((p) => (
                  <tr key={p.salesman_id}>
                    <td><span className="with-icon"><Avatar name={p.salesman_name} size={28} />{p.salesman_name}</span></td>
                    <td className="num">{p.entry_count}</td>
                    <td className="num"><Money paise={p.cash_paise} strong /></td>
                    <td className="num"><Money paise={p.cheque_paise} /></td>
                    {staff && (
                      <td>
                        <div className="inline-form">
                          <input placeholder="Cash handed in ₹" inputMode="decimal" value={declared[p.salesman_id] ?? ''} onChange={(e) => setDeclared((d) => ({ ...d, [p.salesman_id]: e.target.value }))} />
                          <ActionButton
                            className="btn btn-sm btn-primary"
                            disabled={!declared[p.salesman_id]}
                            onClick={async () => {
                              const r = await api<{ day_close: { variance_paise: number } }>('/api/collections/day-close', { method: 'POST', body: { salesman_id: p.salesman_id, declared: declared[p.salesman_id] } });
                              const v = r.day_close?.variance_paise ?? 0;
                              toast(v === 0 ? 'Day closed. Cash matches.' : `Day closed with a difference of ${rupees(v)}`, v === 0 ? 'ok' : 'error');
                              pending.reload();
                              closes.reload();
                            }}
                          >
                            Close
                          </ActionButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {staff && (closes.data?.day_closes ?? []).length > 0 && (
        <Card title="Recent day closes" pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Salesman</th><th className="num">Expected</th><th className="num">Handed in</th><th className="num">Difference</th></tr></thead>
              <tbody>
                {closes.data!.day_closes.map((d) => (
                  <tr key={String(d.id)}>
                    <td>{date(String(d.created_at))}</td>
                    <td>{String(d.salesman_name)}</td>
                    <td className="num">{rupees(Number(d.expected_paise))}</td>
                    <td className="num">{rupees(Number(d.declared_paise))}</td>
                    <td className="num">{Number(d.variance_paise) === 0 ? <Pill tone="green">Matches</Pill> : <Money paise={Number(d.variance_paise)} tone={Number(d.variance_paise) < 0 ? 'bad' : 'good'} strong />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
