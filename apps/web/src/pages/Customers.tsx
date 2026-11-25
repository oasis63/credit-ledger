import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Download, MapPin, Plus, Search, Upload, Users } from 'lucide-react';
import type { CustomerSummary, RiskFlag } from '../api';
import { useAuth } from '../auth';
import { exportExcel } from '../exporting';
import { phone, rupees } from '../format';
import { useApi } from '../hooks';
import { Avatar, Card, Empty, ErrorNote, Kpi, Loading, Money, PageHeader, Pill, RiskBadge, useToast } from '../ui';
import { CustomerForm, type Beat } from './CustomerForm';

type Sort = 'name' | 'balance' | 'overdue';

export function Customers() {
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const facets = useApi<{ areas: Array<{ area: string; n: number }>; tags: Array<{ tag: string; n: number }> }>('/api/customers/facets');
  const beats = useApi<{ beats: Beat[] }>('/api/beats');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const area = params.get('area') ?? '';
  const tag = params.get('tag') ?? '';
  const risk = (params.get('risk') ?? '') as RiskFlag | '';
  const beat = params.get('beat') ?? '';
  const sort = (params.get('sort') as Sort) ?? 'name';
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const list = useMemo(() => {
    let l = data?.customers ?? [];
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((c) => [c.name, c.phone, c.contact_name ?? '', c.area ?? '', c.gstin ?? ''].some((x) => x.toLowerCase().includes(s)));
    if (area) l = l.filter((c) => c.area === area);
    if (tag) l = l.filter((c) => c.tags.includes(tag));
    if (risk) l = l.filter((c) => c.risk.flag === risk && c.balance_paise > 0);
    if (beat) l = l.filter((c) => (beat === 'none' ? !c.beat_id : c.beat_id === beat));
    const by = {
      name: (a: CustomerSummary, b: CustomerSummary) => a.name.localeCompare(b.name),
      balance: (a: CustomerSummary, b: CustomerSummary) => b.balance_paise - a.balance_paise,
      overdue: (a: CustomerSummary, b: CustomerSummary) => b.overdue_paise - a.overdue_paise,
    }[sort];
    return [...l].sort(by);
  }, [data, q, area, tag, risk, beat, sort]);

  const totals = useMemo(
    () => ({
      balance: list.reduce((s, c) => s + Math.max(0, c.balance_paise), 0),
      overdue: list.reduce((s, c) => s + c.overdue_paise, 0),
      over: list.filter((c) => c.overdue_paise > 0).length,
    }),
    [list],
  );
  const beatName = new Map((beats.data?.beats ?? []).map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Every shop you give credit to, with what they owe and how risky they are."
        actions={
          staff && (
            <>
              <button className="btn" onClick={() => nav('/customers/import')}><Upload size={16} />Import</button>
              <button
                className="btn"
                onClick={() =>
                  void exportExcel(`customers-${new Date().toISOString().slice(0, 10)}`, 'Customers', list, [
                    { header: 'Name', value: (c) => c.name, width: 30 },
                    { header: 'Contact', value: (c) => c.contact_name, width: 20 },
                    { header: 'Phone', value: (c) => c.phone, width: 15 },
                    { header: 'Area', value: (c) => c.area, width: 18 },
                    { header: 'GSTIN', value: (c) => c.gstin, width: 18 },
                    { header: 'Balance (₹)', value: (c) => c.balance_paise, money: true },
                    { header: 'Overdue (₹)', value: (c) => c.overdue_paise, money: true },
                    { header: 'Days overdue', value: (c) => c.risk.max_days_overdue },
                    { header: 'Risk', value: (c) => c.risk.flag },
                    { header: 'Credit limit (₹)', value: (c) => c.credit_limit_paise, money: true },
                    { header: 'Credit days', value: (c) => c.credit_days },
                    { header: 'Tags', value: (c) => c.tags.join(', '), width: 20 },
                  ]).catch((e: Error) => toast(e.message, 'error'))
                }
              >
                <Download size={16} />Export
              </button>
              <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Add customer</button>
            </>
          )
        }
      />

      <div className="kpi-grid kpi-grid-3">
        <Kpi label="Customers" value={list.length} sub={`${totals.over} overdue`} icon={<Users size={18} />} />
        <Kpi label="They owe" value={rupees(totals.balance)} tone="brand" />
        <Kpi label="Overdue" value={rupees(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : 'good'} />
      </div>

      <Card pad={false}>
        <div className="toolbar">
          <label className="search">
            <Search size={16} />
            <input placeholder="Search name, phone, contact, area or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select value={area} onChange={(e) => setParam('area', e.target.value)} aria-label="Area">
            <option value="">All areas</option>
            {(facets.data?.areas ?? []).map((a) => <option key={a.area} value={a.area}>{a.area} ({a.n})</option>)}
          </select>
          <select value={beat} onChange={(e) => setParam('beat', e.target.value)} aria-label="Beat">
            <option value="">All beats</option>
            <option value="none">Not on a beat</option>
            {(beats.data?.beats ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={tag} onChange={(e) => setParam('tag', e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            {(facets.data?.tags ?? []).map((t) => <option key={t.tag} value={t.tag}>#{t.tag} ({t.n})</option>)}
          </select>
          <select value={risk} onChange={(e) => setParam('risk', e.target.value)} aria-label="Risk">
            <option value="">Any risk</option>
            <option value="green">Good</option>
            <option value="amber">Watch</option>
            <option value="red">Stop credit</option>
          </select>
          <label className="sort">
            <ArrowDownUp size={15} />
            <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'name' ? '' : e.target.value)} aria-label="Sort">
              <option value="name">Name A–Z</option>
              <option value="balance">Highest balance</option>
              <option value="overdue">Most overdue</option>
            </select>
          </label>
        </div>
        <ErrorNote error={error} />
        {loading && !data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title={data?.customers.length ? 'No customers match' : 'No customers yet'}>
            {staff && !data?.customers.length && (
              <div className="row-gap">
                <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Add customer</button>
                <button className="btn" onClick={() => nav('/customers/import')}><Upload size={16} />Import from Excel</button>
              </div>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Area</th>
                  <th className="num">Balance</th>
                  <th className="num">Overdue</th>
                  <th>Risk</th>
                  <th className="hide-sm">Tally</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/customers/${c.id}`)}>
                    <td>
                      <div className="cell-customer">
                        <Avatar name={c.name} size={34} />
                        <div>
                          <Link to={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="strong-link">{c.name}</Link>
                          <span className="cell-sub">
                            {c.contact_name ? `${c.contact_name} · ` : ''}{phone(c.phone)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {c.area ? <span className="with-icon"><MapPin size={13} />{c.area}</span> : <span className="muted">—</span>}
                      {c.beat_id && <span className="cell-sub">{beatName.get(c.beat_id)}</span>}
                      {c.tags.length > 0 && <div className="tag-row">{c.tags.slice(0, 3).map((t) => <Pill key={t}>#{t}</Pill>)}</div>}
                    </td>
                    <td className="num"><Money paise={c.balance_paise} strong /></td>
                    <td className="num">
                      {c.overdue_paise > 0 ? (
                        <>
                          <Money paise={c.overdue_paise} tone="bad" />
                          <span className="cell-sub">{c.risk.max_days_overdue} days</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{c.balance_paise > 0 ? <RiskBadge flag={c.risk.flag} title={c.risk.reasons.join(' · ')} /> : <Pill tone="green">Settled</Pill>}</td>
                    <td className="hide-sm">
                      {c.tally_balance_paise === null ? (
                        <span className="muted">—</span>
                      ) : c.tally_balance_paise === c.balance_paise ? (
                        <Pill tone="green">Matches</Pill>
                      ) : (
                        <Pill tone="amber">Tally {rupees(c.tally_balance_paise)}</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <CustomerForm
          beats={beats.data?.beats ?? []}
          areas={(facets.data?.areas ?? []).map((a) => a.area)}
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            toast(`${c.name} added`);
            reload();
            facets.reload();
          }}
        />
      )}
    </>
  );
}
