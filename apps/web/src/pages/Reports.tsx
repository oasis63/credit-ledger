import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { BarList, TrendChart } from '../charts';
import { exportExcel } from '../exporting';
import { addDays, date, MODE_LABEL, OUTCOME_LABEL, rupees, startOfMonth, todayIso } from '../format';
import { useApi } from '../hooks';
import { AGING_PARTS, ActionButton, Avatar, Card, Empty, ErrorNote, Kpi, Loading, Money, PageHeader, Pill, Progress, RiskBadge, Tabs, useToast } from '../ui';
import type { RiskFlag } from '../api';

type Tab = 'collections' | 'salesmen' | 'gst' | 'aging';

interface Trend { days: Array<{ date: string; collected_paise: number; billed_paise: number; payments: number }>; by_mode: Array<{ mode: string; amount_paise: number; count: number }>; collected_paise: number; billed_paise: number }
interface Salesman {
  id: string; name: string; active: boolean; daily_target_paise: number; collected_paise: number; collections: number; pending_handover_paise: number;
  visits: number; work_days: number; target_paise: number; achievement_pct: number | null; outcomes: Record<string, number>;
}
interface Gst {
  totals: { bills: number; cancelled: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; b2b_paise: number; b2c_paise: number };
  by_rate: Array<{ gst_rate: number; taxable_paise: number; tax_paise: number }>;
  by_hsn: Array<{ hsn: string; gst_rate: number; qty: number; taxable_paise: number; tax_paise: number }>;
  bills: Array<{ id: string; bill_no: string; bill_date: string; customer_name: string; customer_gstin: string | null; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; cancelled_at: string | null }>;
}
interface AgingRow { id: string; name: string; phone: string; area: string | null; balance_paise: number; overdue_paise: number; not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; risk: RiskFlag }

const PRESETS: Array<[string, (t: string) => [string, string]]> = [
  ['Today', (t) => [t, t]],
  ['7 days', (t) => [addDays(t, -6), t]],
  ['This month', (t) => [startOfMonth(t), t]],
  ['30 days', (t) => [addDays(t, -29), t]],
  ['90 days', (t) => [addDays(t, -89), t]],
];

export function Reports() {
  const today = todayIso();
  const [tab, setTab] = useState<Tab>('collections');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  return (
    <>
      <PageHeader title="Reports" subtitle="Collections, team performance, GST and ageing. Export any report to Excel or print it as PDF." actions={<button className="btn" onClick={() => window.print()}><Printer size={16} />Print</button>} />
      <div className="report-bar">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'collections', label: 'Collections' }, { id: 'salesmen', label: 'Salesmen' }, { id: 'gst', label: 'GST' }, { id: 'aging', label: 'Ageing' }]} />
        {tab !== 'aging' && (
          <div className="date-range">
            <div className="chip-row">
              {PRESETS.map(([label, fn]) => {
                const [f, t] = fn(today);
                return <button key={label} className={`chip ${f === from && t === to ? 'on' : ''}`} onClick={() => (setFrom(f), setTo(t))}>{label}</button>;
              })}
            </div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
        )}
      </div>
      {tab === 'collections' && <CollectionsReport from={from} to={to} />}
      {tab === 'salesmen' && <SalesmenReport from={from} to={to} />}
      {tab === 'gst' && <GstReport from={from} to={to} />}
      {tab === 'aging' && <AgingReport />}
    </>
  );
}

function CollectionsReport({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const { data, error, loading } = useApi<Trend>(`/api/reports/trend?from=${from}&to=${to}`);
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const best = [...data.days].sort((a, b) => b.collected_paise - a.collected_paise)[0];
  const avg = data.days.length ? Math.round(data.collected_paise / data.days.length) : 0;
  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Collected" value={rupees(data.collected_paise)} tone="good" sub={`${data.days.reduce((s, d) => s + d.payments, 0)} payments`} />
        <Kpi label="Billed" value={rupees(data.billed_paise)} tone="brand" />
        <Kpi label="Collection ratio" value={data.billed_paise ? `${Math.round((data.collected_paise / data.billed_paise) * 100)}%` : '—'} sub="Collected ÷ billed" />
        <Kpi label="Daily average" value={rupees(avg)} sub={best && best.collected_paise ? `Best: ${date(best.date)} (${rupees(best.collected_paise)})` : undefined} />
      </div>
      <Card
        title="By day"
        actions={
          <button
            className="btn btn-sm"
            onClick={() =>
              void exportExcel(`collections-${from}-to-${to}`, 'Collections', data.days, [
                { header: 'Date', value: (d) => d.date },
                { header: 'Collected (₹)', value: (d) => d.collected_paise, money: true },
                { header: 'Payments', value: (d) => d.payments },
                { header: 'Billed (₹)', value: (d) => d.billed_paise, money: true },
              ]).catch((e: Error) => toast(e.message, 'error'))
            }
          >
            <Download size={15} />Excel
          </button>
        }
      >
        <TrendChart days={data.days} height={280} />
      </Card>
      <Card title="By payment mode">
        {data.by_mode.length ? <BarList items={data.by_mode.map((m) => ({ label: MODE_LABEL[m.mode] ?? m.mode, value: m.amount_paise, hint: `${m.count} payments` }))} /> : <Empty title="No payments in this period" />}
      </Card>
    </>
  );
}

function SalesmenReport({ from, to }: { from: string; to: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ salesmen: Salesman[] }>(`/api/reports/salesmen?from=${from}&to=${to}`);
  const [targets, setTargets] = useState<Record<string, string>>({});
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  const list = data?.salesmen ?? [];
  if (list.length === 0) return <Empty title="No salesmen yet">Add them in <Link to="/settings">Settings</Link>.</Empty>;
  return (
    <Card
      title="Performance"
      pad={false}
      actions={
        <button
          className="btn btn-sm"
          onClick={() =>
            void exportExcel(`salesmen-${from}-to-${to}`, 'Salesmen', list, [
              { header: 'Salesman', value: (s) => s.name, width: 24 },
              { header: 'Collected (₹)', value: (s) => s.collected_paise, money: true },
              { header: 'Target (₹)', value: (s) => s.target_paise, money: true },
              { header: 'Achievement %', value: (s) => s.achievement_pct },
              { header: 'Payments', value: (s) => s.collections },
              { header: 'Visits', value: (s) => s.visits },
              { header: 'Days worked', value: (s) => s.work_days },
              { header: 'Not handed over (₹)', value: (s) => s.pending_handover_paise, money: true },
            ]).catch((e: Error) => toast(e.message, 'error'))
          }
        >
          <Download size={15} />Excel
        </button>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Salesman</th><th className="num">Collected</th><th>Target</th><th className="num">Visits</th><th className="hide-sm">Outcomes</th><th className="num">With them</th>{user?.role === 'owner' && <th>Daily target ₹</th>}</tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'row-muted'}>
                <td><span className="with-icon"><Avatar name={s.name} size={30} /><span><b>{s.name}</b><span className="cell-sub">{s.collections} payments · {s.work_days} days</span></span></span></td>
                <td className="num"><Money paise={s.collected_paise} strong /></td>
                <td className="target-cell">
                  {s.target_paise ? (<><Progress value={s.collected_paise} max={s.target_paise} /><span className="cell-sub">{s.achievement_pct}% of {rupees(s.target_paise)}</span></>) : <span className="muted">No target</span>}
                </td>
                <td className="num">{s.visits}</td>
                <td className="hide-sm">
                  <div className="tag-row">{Object.entries(s.outcomes ?? {}).map(([k, n]) => <Pill key={k} tone={k === 'collected' ? 'green' : k === 'promised' ? 'blue' : 'neutral'}>{OUTCOME_LABEL[k] ?? k} {n}</Pill>)}</div>
                </td>
                <td className="num">{s.pending_handover_paise ? <Money paise={s.pending_handover_paise} tone="bad" /> : <span className="muted">—</span>}</td>
                {user?.role === 'owner' && (
                  <td>
                    <div className="inline-form">
                      <input
                        className="w-rate"
                        inputMode="decimal"
                        placeholder={String(s.daily_target_paise / 100)}
                        value={targets[s.id] ?? ''}
                        onChange={(e) => setTargets((t) => ({ ...t, [s.id]: e.target.value }))}
                      />
                      <ActionButton
                        className="btn btn-sm"
                        disabled={!targets[s.id]}
                        onClick={async () => {
                          await api(`/api/settings/users/${s.id}`, { method: 'PATCH', body: { daily_target: targets[s.id] } });
                          setTargets((t) => ({ ...t, [s.id]: '' }));
                          reload();
                        }}
                        okText="Target saved"
                      >
                        Set
                      </ActionButton>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GstReport({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const { data, error, loading } = useApi<Gst>(`/api/reports/gst?from=${from}&to=${to}`);
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const t = data.totals;
  const exportAll = () =>
    exportExcel(`gst-${from}-to-${to}`, 'Bills', data.bills, [
      { header: 'Bill no', value: (b) => b.bill_no },
      { header: 'Date', value: (b) => b.bill_date },
      { header: 'Customer', value: (b) => b.customer_name, width: 28 },
      { header: 'Customer GSTIN', value: (b) => b.customer_gstin, width: 18 },
      { header: 'Taxable (₹)', value: (b) => b.taxable_paise, money: true },
      { header: 'CGST (₹)', value: (b) => b.cgst_paise, money: true },
      { header: 'SGST (₹)', value: (b) => b.sgst_paise, money: true },
      { header: 'IGST (₹)', value: (b) => b.igst_paise, money: true },
      { header: 'Total (₹)', value: (b) => b.total_paise, money: true },
      { header: 'Status', value: (b) => (b.cancelled_at ? 'Cancelled' : 'Active') },
    ]).catch((e: Error) => toast(e.message, 'error'));
  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Taxable value" value={rupees(t.taxable_paise)} tone="brand" sub={`${t.bills} bills${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}`} />
        <Kpi label="CGST + SGST" value={rupees(t.cgst_paise + t.sgst_paise)} sub={`CGST ${rupees(t.cgst_paise)} · SGST ${rupees(t.sgst_paise)}`} />
        <Kpi label="IGST" value={rupees(t.igst_paise)} sub="Inter-state" />
        <Kpi label="Invoice value" value={rupees(t.total_paise)} sub={`B2B ${rupees(t.b2b_paise)} · B2C ${rupees(t.b2c_paise)}`} />
      </div>
      <div className="grid-2">
        <Card title="By GST rate" pad={false}>
          {data.by_rate.length === 0 ? <Empty title="No bills in this period" /> : (
            <table className="table">
              <thead><tr><th>Rate</th><th className="num">Taxable</th><th className="num">Tax</th></tr></thead>
              <tbody>{data.by_rate.map((r) => <tr key={r.gst_rate}><td>{r.gst_rate}%</td><td className="num">{rupees(r.taxable_paise)}</td><td className="num">{rupees(r.tax_paise)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card title="HSN summary" pad={false}>
          {data.by_hsn.length === 0 ? <Empty title="No items" /> : (
            <table className="table">
              <thead><tr><th>HSN</th><th>Rate</th><th className="num">Qty</th><th className="num">Taxable</th><th className="num">Tax</th></tr></thead>
              <tbody>{data.by_hsn.map((h) => <tr key={`${h.hsn}-${h.gst_rate}`}><td>{h.hsn || <span className="muted">none</span>}</td><td>{h.gst_rate}%</td><td className="num">{h.qty}</td><td className="num">{rupees(h.taxable_paise)}</td><td className="num">{rupees(h.tax_paise)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
      <Card title="Bills" pad={false} actions={<button className="btn btn-sm" onClick={() => void exportAll()}><Download size={15} />Excel for your CA</button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {data.bills.map((b) => (
                <tr key={b.id} className={b.cancelled_at ? 'row-muted' : ''}>
                  <td><Link to={`/bills/${b.id}`}>{b.bill_no}</Link></td>
                  <td>{date(b.bill_date)}</td>
                  <td>{b.customer_name}{b.customer_gstin && <span className="cell-sub">{b.customer_gstin}</span>}</td>
                  <td className="num">{rupees(b.taxable_paise)}</td>
                  <td className="num">{rupees(b.cgst_paise + b.sgst_paise + b.igst_paise)}</td>
                  <td className="num"><b>{rupees(b.total_paise)}</b></td>
                  <td>{b.cancelled_at && <Pill tone="red">Cancelled</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function AgingReport() {
  const toast = useToast();
  const { data, error, loading } = useApi<{ as_of: string; customers: AgingRow[] }>('/api/reports/aging');
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const total = (k: keyof AgingRow) => data.customers.reduce((s, c) => s + Number(c[k]), 0);
  return (
    <Card
      title={`Ageing as of ${date(data.as_of)}`}
      pad={false}
      actions={
        <button
          className="btn btn-sm"
          onClick={() =>
            void exportExcel(`ageing-${data.as_of}`, 'Ageing', data.customers, [
              { header: 'Customer', value: (c) => c.name, width: 28 },
              { header: 'Phone', value: (c) => c.phone },
              { header: 'Area', value: (c) => c.area },
              ...AGING_PARTS.map(([k, label]) => ({ header: `${label} (₹)`, value: (c: AgingRow) => c[k], money: true })),
              { header: 'Balance (₹)', value: (c) => c.balance_paise, money: true },
              { header: 'Risk', value: (c) => c.risk },
            ]).catch((e: Error) => toast(e.message, 'error'))
          }
        >
          <Download size={15} />Excel
        </button>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Customer</th>{AGING_PARTS.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Balance</th><th>Risk</th></tr>
          </thead>
          <tbody>
            {data.customers.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/customers/${c.id}`}>{c.name}</Link>{c.area && <span className="cell-sub">{c.area}</span>}</td>
                {AGING_PARTS.map(([k]) => <td key={k} className={`num ${k !== 'not_due' && c[k] ? 'neg' : ''}`}>{c[k] ? rupees(c[k]) : ''}</td>)}
                <td className="num"><b>{rupees(c.balance_paise)}</b></td>
                <td><RiskBadge flag={c.risk} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>Total</td>{AGING_PARTS.map(([k]) => <td key={k} className="num">{rupees(total(k))}</td>)}<td className="num">{rupees(total('balance_paise'))}</td><td /></tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
