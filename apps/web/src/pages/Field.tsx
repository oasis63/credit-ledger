import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, MapPin, Navigation, Pencil, Plus, Route, Target, Trash2, X } from 'lucide-react';
import type { CustomerSummary, FieldToday, VisitOutcome } from '@credit-ledger/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { MapView, type MapPoint } from '../MapView';
import { dateTime, OUTCOME_LABEL, rupees, todayIso, WEEKDAYS } from '../format';
import { useApi } from '../hooks';
import { ActionButton, Avatar, Card, Empty, ErrorNote, Field as FormField, Kpi, Loading, Modal, Money, PageHeader, Pill, Progress, Tabs, useToast } from '../ui';

interface Beat { id: string; name: string; salesman_id: string | null; salesman_name: string | null; weekdays: number[]; customer_count: number }
interface UserRow { id: string; name: string; role: string; active: boolean; daily_target_paise: number }
type Tab = 'today' | 'beats' | 'map' | 'visits';

export function Field() {
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const [tab, setTab] = useState<Tab>('today');
  return (
    <>
      <PageHeader title="Field & beats" subtitle={staff ? 'Plan routes, set targets, and see what your salesmen did today.' : 'Your route for today.'} />
      {staff && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'today', label: 'Today' },
            { id: 'beats', label: 'Beats' },
            { id: 'map', label: 'Map' },
            { id: 'visits', label: 'Visits log' },
          ]}
        />
      )}
      <div className="tab-body">
        {tab === 'today' && <Today staff={staff} />}
        {tab === 'beats' && staff && <Beats />}
        {tab === 'map' && staff && <ShopMap />}
        {tab === 'visits' && staff && <Visits />}
      </div>
    </>
  );
}

function Today({ staff }: { staff: boolean }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const users = useApi<{ salesmen: UserRow[] }>(staff ? `/api/reports/salesmen?from=${todayIso()}&to=${todayIso()}` : null);
  const salesmen = (users.data?.salesmen ?? []).filter((u) => u.role === 'salesman' && u.active);
  const [who, setWho] = useState<string>('');
  const [day, setDay] = useState(todayIso());
  const salesmanId = staff ? who || salesmen[0]?.id || '' : user!.id;
  const { data, error, loading, reload } = useApi<FieldToday>(salesmanId ? `/api/field/today?date=${day}&salesman_id=${salesmanId}` : null);
  const [checkIn, setCheckIn] = useState<FieldToday['stops'][number] | null>(null);

  if (staff && users.data && salesmen.length === 0) {
    return <Empty title="No salesmen yet" icon={<Route size={22} />}>Add salesmen in <Link to="/settings">Settings</Link>, then create beats for them.</Empty>;
  }
  const points: MapPoint[] = (data?.stops ?? [])
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s, i) => ({
      id: s.id, lat: s.lat!, lng: s.lng!, title: s.name, subtitle: s.overdue_paise > 0 ? `Overdue ${rupees(s.overdue_paise)}` : `Owes ${rupees(s.balance_paise)}`,
      tone: s.visit ? 'blue' : s.overdue_paise > 0 ? 'red' : 'green', label: String(i + 1),
    }));

  return (
    <>
      <div className="toolbar toolbar-flat">
        {staff && (
          <select value={salesmanId} onChange={(e) => setWho(e.target.value)} aria-label="Salesman">
            {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
        {data && <span className="muted">{WEEKDAYS[data.weekday]} · {data.beats.length ? data.beats.map((b) => b.name).join(', ') : 'No beat scheduled'}</span>}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Collected"
              value={rupees(data.collected_paise)}
              sub={data.target_paise ? <><Progress value={data.collected_paise} max={data.target_paise} />{Math.round((data.collected_paise / data.target_paise) * 100)}% of {rupees(data.target_paise)} target</> : `${data.collections} payments · no target set`}
              icon={<Target size={18} />}
              tone="good"
            />
            <Kpi label="Shops visited" value={`${data.visited} / ${data.stops.length}`} sub={<Progress value={data.visited} max={Math.max(1, data.stops.length)} tone="good" />} icon={<CheckCircle2 size={18} />} />
            <Kpi label="Overdue on route" value={rupees(data.to_collect_paise)} tone={data.to_collect_paise ? 'bad' : undefined} icon={<Route size={18} />} />
          </div>
          {data.stops.length === 0 ? (
            <Empty title="No shops on today's route" icon={<Route size={22} />}>
              {staff ? 'Create a beat for this salesman for this weekday in the Beats tab.' : 'Ask your office to set up your beats.'}
            </Empty>
          ) : (
            <div className="grid-2">
              <Card title="Route" pad={false}>
                <div className="list">
                  {data.stops.map((s, i) => (
                    <div key={s.id} className={`list-row stop ${s.visit ? 'done' : ''}`}>
                      <span className="stop-no">{s.visit ? <CheckCircle2 size={18} /> : i + 1}</span>
                      <div className="list-main">
                        <Link to={`/customers/${s.id}`}><b>{s.name}</b></Link>
                        <span>
                          {[s.contact_name, s.area].filter(Boolean).join(' · ')}
                          {s.visit ? ` · ${OUTCOME_LABEL[s.visit.outcome]}` : ''}
                        </span>
                      </div>
                      <div className="list-end">
                        {s.overdue_paise > 0 ? <Money paise={s.overdue_paise} tone="bad" strong /> : <Money paise={s.balance_paise} />}
                        <div className="row-gap-sm">
                          {s.lat !== null && (
                            <a className="icon-btn" title="Directions" href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noreferrer"><Navigation size={16} /></a>
                          )}
                          {!staff && !s.visit && <button className="btn btn-sm" onClick={() => setCheckIn(s)}>Check in</button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Map" pad={false}>
                {points.length ? <MapView points={points} route onOpen={(id) => nav(`/customers/${id}`)} /> : <Empty title="No shop locations yet" icon={<MapPin size={22} />}>Locations are saved automatically the first time a salesman checks in at a shop.</Empty>}
              </Card>
            </div>
          )}
          {data.overdue_elsewhere.length > 0 && (
            <Card title="Overdue shops on other beats" pad={false}>
              <div className="list">
                {data.overdue_elsewhere.map((o) => (
                  <Link key={o.id} to={`/customers/${o.id}`} className="list-row">
                    <div className="list-main"><b>{o.name}</b><span>{[o.area, o.beat_name].filter(Boolean).join(' · ')}</span></div>
                    <Money paise={o.overdue_paise} tone="bad" strong />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {checkIn && <CheckInModal stop={checkIn} onClose={() => setCheckIn(null)} onDone={() => (setCheckIn(null), reload())} />}
    </>
  );
}

function CheckInModal({ stop, onClose, onDone }: { stop: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<VisitOutcome>('collected');
  const [note, setNote] = useState('');
  const toast = useToast();
  return (
    <Modal
      title={`Check in at ${stop.name}`}
      onClose={onClose}
      size="sm"
      footer={
        <ActionButton
          className="btn btn-primary"
          onClick={async () => {
            const pos = await new Promise<GeolocationPosition | null>((res) =>
              navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 8000 }) : res(null),
            );
            await api('/api/visits', {
              method: 'POST',
              body: {
                customer_id: stop.id, outcome, note: note || undefined,
                ...(pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy } : {}),
              },
            });
            toast('Visit saved');
            onDone();
          }}
        >
          Save visit
        </ActionButton>
      }
    >
      <div className="choice-grid">
        {(Object.keys(OUTCOME_LABEL) as VisitOutcome[]).map((o) => (
          <button key={o} className={`choice ${outcome === o ? 'on' : ''}`} onClick={() => setOutcome(o)}>{outcome === o ? <CheckCircle2 size={16} /> : <Circle size={16} />}{OUTCOME_LABEL[o]}</button>
        ))}
      </div>
      <FormField label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Will pay on Friday" /></FormField>
    </Modal>
  );
}

function Beats() {
  const toast = useToast();
  const beats = useApi<{ beats: Beat[] }>('/api/beats');
  const users = useApi<{ salesmen: UserRow[] }>(`/api/reports/salesmen?from=${todayIso()}&to=${todayIso()}`);
  const [editing, setEditing] = useState<Beat | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Beat | null>(null);
  return (
    <>
      <div className="section-head">
        <p className="muted">A beat is a fixed route: a list of shops a salesman visits on certain days. The mobile app shows each salesman today's shops in order.</p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} />New beat</button>
      </div>
      <ErrorNote error={beats.error} />
      {(beats.data?.beats ?? []).length === 0 ? (
        <Empty title="No beats yet" icon={<Route size={22} />}><button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} />Create your first beat</button></Empty>
      ) : (
        <div className="card-grid">
          {beats.data!.beats.map((b) => (
            <div key={b.id} className="beat-card">
              <div className="beat-top">
                <b>{b.name}</b>
                <div className="row-gap-sm">
                  <button className="icon-btn" title="Edit" onClick={() => setEditing(b)}><Pencil size={15} /></button>
                  <ActionButton
                    className="icon-btn"
                    title="Delete beat"
                    onClick={async () => {
                      if (!confirm(`Delete beat "${b.name}"? Shops stay, they just leave the beat.`)) return;
                      await api(`/api/beats/${b.id}`, { method: 'DELETE' });
                      beats.reload();
                    }}
                  >
                    <Trash2 size={15} />
                  </ActionButton>
                </div>
              </div>
              <div className="weekday-row">{WEEKDAYS.map((d, i) => <span key={d} className={b.weekdays.includes(i) ? 'on' : ''}>{d[0]}</span>)}</div>
              <div className="beat-meta">
                {b.salesman_name ? <span className="with-icon"><Avatar name={b.salesman_name} size={22} />{b.salesman_name}</span> : <Pill tone="amber">No salesman</Pill>}
                <span>{b.customer_count} shops</span>
              </div>
              <button className="btn btn-sm btn-block" onClick={() => setAssigning(b)}>Choose shops & order</button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <BeatForm
          beat={editing === 'new' ? null : editing}
          salesmen={(users.data?.salesmen ?? []).filter((u) => u.role === 'salesman' && u.active)}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), toast('Beat saved'), beats.reload())}
        />
      )}
      {assigning && <AssignShops beat={assigning} onClose={() => setAssigning(null)} onSaved={() => (setAssigning(null), toast('Shops saved'), beats.reload())} />}
    </>
  );
}

function BeatForm({ beat, salesmen, onClose, onSaved }: { beat: Beat | null; salesmen: UserRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(beat?.name ?? '');
  const [salesman, setSalesman] = useState(beat?.salesman_id ?? salesmen[0]?.id ?? '');
  const [days, setDays] = useState<number[]>(beat?.weekdays ?? []);
  return (
    <Modal
      title={beat ? 'Edit beat' : 'New beat'}
      onClose={onClose}
      size="sm"
      footer={
        <ActionButton
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            const body = { name, salesman_id: salesman || null, weekdays: days };
            if (beat) await api(`/api/beats/${beat.id}`, { method: 'PATCH', body });
            else await api('/api/beats', { method: 'POST', body });
            onSaved();
          }}
        >
          Save beat
        </ActionButton>
      }
    >
      <FormField label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Karol Bagh – Monday" autoFocus /></FormField>
      <FormField label="Salesman">
        <select value={salesman} onChange={(e) => setSalesman(e.target.value)}>
          <option value="">Nobody yet</option>
          {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FormField>
      <FormField label="Days">
        <div className="weekday-picker">
          {WEEKDAYS.map((d, i) => (
            <button key={d} type="button" className={days.includes(i) ? 'on' : ''} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>{d}</button>
          ))}
        </div>
      </FormField>
    </Modal>
  );
}

function AssignShops({ beat, onClose, onSaved }: { beat: Beat; onClose: () => void; onSaved: () => void }) {
  const customers = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const [order, setOrder] = useState<string[] | null>(null);
  const [q, setQ] = useState('');
  const all = customers.data?.customers ?? [];
  const current = order ?? all.filter((c) => c.beat_id === beat.id).sort((a, b) => a.beat_order - b.beat_order).map((c) => c.id);
  const byId = new Map(all.map((c) => [c.id, c]));
  const available = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((c) => !current.includes(c.id) && (!s || c.name.toLowerCase().includes(s) || (c.area ?? '').toLowerCase().includes(s)));
  }, [all, current, q]);
  const move = (i: number, d: -1 | 1) => {
    const n = [...current];
    [n[i], n[i + d]] = [n[i + d]!, n[i]!];
    setOrder(n);
  };
  return (
    <Modal
      title={`Shops on ${beat.name}`}
      onClose={onClose}
      size="lg"
      footer={<ActionButton className="btn btn-primary" onClick={async () => (await api(`/api/beats/${beat.id}/customers`, { method: 'PUT', body: { customer_ids: current } }), onSaved())}>Save {current.length} shops</ActionButton>}
    >
      {customers.loading && !customers.data ? <Loading /> : (
        <div className="assign-grid">
          <div>
            <h3 className="sub-h">Add shops</h3>
            <input className="full" placeholder="Search by name or area" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="assign-list">
              {available.slice(0, 200).map((c) => (
                <button key={c.id} className="assign-item" onClick={() => setOrder([...current, c.id])}>
                  <Plus size={14} />
                  <span>{c.name}<small>{[c.area, c.beat_id && c.beat_id !== beat.id ? 'on another beat' : null].filter(Boolean).join(' · ')}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="sub-h">Visiting order ({current.length})</h3>
            <div className="assign-list">
              {current.map((id, i) => {
                const c = byId.get(id);
                return (
                  <div key={id} className="assign-item fixed">
                    <span className="stop-no">{i + 1}</span>
                    <span>{c?.name}<small>{c?.area}</small></span>
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                    <button className="icon-btn" disabled={i === current.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
                    <button className="icon-btn" onClick={() => setOrder(current.filter((x) => x !== id))} aria-label="Remove"><X size={14} /></button>
                  </div>
                );
              })}
              {current.length === 0 && <p className="muted small">Pick shops from the left.</p>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ShopMap() {
  const nav = useNavigate();
  const { data, loading } = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const beats = useApi<{ beats: Beat[] }>('/api/beats');
  const [beat, setBeat] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const list = (data?.customers ?? []).filter((c) => (!beat || c.beat_id === beat) && (!onlyOverdue || c.overdue_paise > 0));
  const located = list.filter((c) => c.lat !== null && c.lng !== null);
  const points: MapPoint[] = located.map((c) => ({
    id: c.id, lat: c.lat!, lng: c.lng!, title: c.name,
    subtitle: c.overdue_paise > 0 ? `Overdue ${rupees(c.overdue_paise)} · ${c.risk.max_days_overdue} days` : c.balance_paise > 0 ? `Owes ${rupees(c.balance_paise)}` : 'Settled',
    tone: c.balance_paise <= 0 ? 'grey' : c.risk.flag,
  }));
  return (
    <>
      <div className="toolbar toolbar-flat">
        <select value={beat} onChange={(e) => setBeat(e.target.value)} aria-label="Beat">
          <option value="">All beats</option>
          {(beats.data?.beats ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />Only overdue</label>
        <span className="muted">{located.length} of {list.length} shops have a location</span>
        <span className="legend-inline"><i className="dot seg-green" />Good <i className="dot seg-amber" />Watch <i className="dot seg-red" />Stop credit <i className="dot dot-grey" />Settled</span>
      </div>
      {loading && !data ? <Loading /> : <Card pad={false}><MapView points={points} height={560} onOpen={(id) => nav(`/customers/${id}`)} /></Card>}
      {located.length === 0 && !loading && <p className="muted small">Shops get a location automatically when a salesman checks in there from the mobile app.</p>}
    </>
  );
}

function Visits() {
  const [day, setDay] = useState(todayIso());
  const { data, error, loading } = useApi<{ visits: Array<{ id: string; customer_id: string; customer_name: string; salesman_name: string; outcome: VisitOutcome; note: string | null; created_at: string; lat: number | null }> }>(
    `/api/visits?from=${day}&to=${day}&limit=500`,
  );
  return (
    <>
      <div className="toolbar toolbar-flat"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" /></div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : (data?.visits ?? []).length === 0 ? <Empty title="No visits on this day" /> : (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Shop</th><th>Salesman</th><th>Outcome</th><th>Note</th><th>GPS</th></tr></thead>
              <tbody>
                {data!.visits.map((v) => (
                  <tr key={v.id}>
                    <td className="nowrap">{dateTime(v.created_at)}</td>
                    <td><Link to={`/customers/${v.customer_id}`}>{v.customer_name}</Link></td>
                    <td>{v.salesman_name}</td>
                    <td><Pill tone={v.outcome === 'collected' ? 'green' : v.outcome === 'promised' ? 'blue' : v.outcome === 'order_taken' ? 'violet' : 'amber'}>{OUTCOME_LABEL[v.outcome]}</Pill></td>
                    <td className="muted">{v.note}</td>
                    <td>{v.lat !== null ? <Pill tone="green">Yes</Pill> : <span className="muted">—</span>}</td>
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

