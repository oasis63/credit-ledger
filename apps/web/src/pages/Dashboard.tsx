import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Banknote, CalendarClock, FileText, MessageSquareWarning, Send, Users, Wallet } from 'lucide-react';
import { api, type Aging, type Risk } from '../api';
import { useAuth } from '../auth';
import { BarList, Donut, TrendChart } from '../charts';
import { addDays, date, MODE_LABEL, rupees, todayIso } from '../format';
import { useApi } from '../hooks';
import { ActionButton, AgingBar, Avatar, Card, Empty, ErrorNote, Kpi, Loading, Money, PageHeader, RiskBadge } from '../ui';

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

interface Trend {
  days: Array<{ date: string; collected_paise: number; billed_paise: number; payments: number }>;
  by_mode: Array<{ mode: string; amount_paise: number; count: number }>;
  collected_paise: number;
  billed_paise: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const today = todayIso();
  const { data, error, loading, reload } = useApi<DashboardData>('/api/reports/dashboard');
  const trend = useApi<Trend>(`/api/reports/trend?from=${addDays(today, -29)}&to=${today}`);
  const salesmen = useApi<{ salesmen: Array<{ id: string; name: string; collected_paise: number; achievement_pct: number | null; visits: number }> }>(
    `/api/reports/salesmen?from=${today}&to=${today}`,
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const t = trend.data;
  const todayRow = t?.days[t.days.length - 1];
  const hour = new Date().getHours();
  const collectionRate = t && t.billed_paise > 0 ? Math.round((t.collected_paise / t.billed_paise) * 100) : null;

  return (
    <>
      <PageHeader
        title={`${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle={`Here's where your money stands today, ${date(data.as_of)}.`}
        actions={
          <>
            <ActionButton
              className="btn"
              onClick={async () => {
                const r = await api<{ sent: number; failed: number; skipped_recently_reminded: number }>('/api/reminders/bulk', { method: 'POST', body: {} });
                reload();
                return r;
              }}
              okText="Reminders sent to overdue customers"
            >
              <Send size={16} />Remind all overdue
            </ActionButton>
            <button className="btn btn-primary" onClick={() => nav('/bills/new')}><FileText size={16} />New bill</button>
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Total receivable" value={rupees(data.receivable_paise)} sub={`${data.customers_with_balance} customers owe you`} icon={<Wallet size={18} />} tone="brand" />
        <Kpi
          label="Overdue"
          value={rupees(data.overdue_paise)}
          sub={data.receivable_paise ? `${Math.round((data.overdue_paise / data.receivable_paise) * 100)}% of receivable` : '—'}
          icon={<AlertCircle size={18} />}
          tone={data.overdue_paise > 0 ? 'bad' : 'good'}
        />
        <Kpi
          label="Collected (30 days)"
          value={t ? rupees(t.collected_paise) : '…'}
          sub={collectionRate !== null ? `${collectionRate}% of billing · today ${rupees(todayRow?.collected_paise ?? 0)}` : 'Last 30 days'}
          icon={<Banknote size={18} />}
          tone="good"
        />
        <Kpi
          label="Cash with salesmen"
          value={rupees(data.cash_pending_handover_paise)}
          sub={<Link to="/collections">Close the day <ArrowUpRight size={12} /></Link>}
          icon={<Users size={18} />}
          tone={data.cash_pending_handover_paise > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="grid-2-1">
        <Card title="Collections vs billing" actions={<Link className="link" to="/reports">Reports <ArrowUpRight size={14} /></Link>}>
          {t ? <TrendChart days={t.days} /> : <Loading />}
        </Card>
        <Card title="Customers by risk">
          <div className="risk-split">
            <Donut
              parts={[
                { value: data.risk.green, className: 'seg-green', label: 'Good' },
                { value: data.risk.amber, className: 'seg-amber', label: 'Watch' },
                { value: data.risk.red, className: 'seg-red', label: 'Stop credit' },
              ]}
              label={String(data.risk.green + data.risk.amber + data.risk.red)}
              sub="with balance"
            />
            <div className="risk-legend">
              <div><RiskBadge flag="green" /><b>{data.risk.green}</b></div>
              <div><RiskBadge flag="amber" /><b>{data.risk.amber}</b></div>
              <div><RiskBadge flag="red" /><b>{data.risk.red}</b></div>
              <Link to="/disputes" className="mini-stat">
                <MessageSquareWarning size={15} />{data.open_disputes} open dispute{data.open_disputes === 1 ? '' : 's'}
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Receivables by age">
        <AgingBar aging={data.aging} />
      </Card>

      <div className="grid-2">
        <Card title="Most overdue" actions={<Link className="link" to="/customers?sort=overdue">All customers <ArrowUpRight size={14} /></Link>} pad={false}>
          {data.top_overdue.length === 0 ? (
            <Empty title="Nobody is overdue">Great collections!</Empty>
          ) : (
            <div className="list">
              {data.top_overdue.map((c) => (
                <Link key={c.id} to={`/customers/${c.id}`} className="list-row">
                  <Avatar name={c.name} />
                  <div className="list-main">
                    <b>{c.name}</b>
                    <span>{c.risk.max_days_overdue} days overdue · owes {rupees(c.balance_paise)}</span>
                  </div>
                  <div className="list-end">
                    <Money paise={c.overdue_paise} tone="bad" strong />
                    <RiskBadge flag={c.risk.flag} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title={<><CalendarClock size={17} /> Promises due</>} pad={false}>
            {data.promises_due.length === 0 ? (
              <Empty title="No promises due">When a shop replies “will pay Friday” on WhatsApp, it shows up here.</Empty>
            ) : (
              <div className="list">
                {data.promises_due.map((p) => (
                  <Link key={p.id} to={`/customers/${p.customer_id}`} className="list-row">
                    <div className="list-main">
                      <b>{p.customer_name}</b>
                      <span>by {date(p.promised_date)}</span>
                    </div>
                    <div className="list-end">{p.amount_paise ? <Money paise={p.amount_paise} strong /> : <span className="muted">Payment</span>}</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title="Today in the field" pad={false}>
            {(salesmen.data?.salesmen ?? []).length === 0 ? (
              <Empty title="No salesmen yet">Add salesmen in Settings and give them beats in Field & beats.</Empty>
            ) : (
              <div className="list">
                {salesmen.data!.salesmen.map((s) => (
                  <div key={s.id} className="list-row">
                    <Avatar name={s.name} />
                    <div className="list-main">
                      <b>{s.name}</b>
                      <span>{s.visits} visits{s.achievement_pct !== null ? ` · ${s.achievement_pct}% of target` : ''}</span>
                    </div>
                    <div className="list-end"><Money paise={s.collected_paise} strong /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {t && t.by_mode.length > 0 && (
            <Card title="How customers pay (30 days)">
              <BarList items={t.by_mode.map((m) => ({ label: MODE_LABEL[m.mode] ?? m.mode, value: m.amount_paise, hint: `${m.count} payments` }))} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
