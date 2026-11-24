import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { Aging, RiskFlag } from './api';
import { useAuth } from './auth';
import { rupees } from './format';

export function Layout() {
  const { user, signOut } = useAuth();
  const staff = user?.role === 'owner' || user?.role === 'accountant';
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Credit Ledger</span>
        <nav>
          {staff && <NavLink to="/">Dashboard</NavLink>}
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/collections">Collections</NavLink>
          {staff && <NavLink to="/disputes">Disputes</NavLink>}
          {user?.role === 'owner' && <NavLink to="/settings">Settings</NavLink>}
        </nav>
        <span className="who">
          {user?.name} · {user?.role}{' '}
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </span>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function RiskBadge({ flag, title }: { flag: RiskFlag; title?: string }) {
  const label = { green: 'Good', amber: 'Watch', red: 'Stop credit' }[flag];
  return (
    <span className={`badge badge-${flag}`} title={title}>
      {label}
    </span>
  );
}

export function AgingBar({ aging }: { aging: Aging }) {
  const parts: Array<[keyof Aging, string]> = [
    ['not_due', 'Not due'],
    ['d1_30', '1–30 days'],
    ['d31_60', '31–60'],
    ['d61_90', '61–90'],
    ['d90_plus', '90+'],
  ];
  const total = parts.reduce((s, [k]) => s + aging[k], 0);
  return (
    <div>
      <div className="agingbar" role="img" aria-label="Receivables by age">
        {total > 0 &&
          parts.map(([k]) =>
            aging[k] > 0 ? <span key={k} className={`seg seg-${k}`} style={{ width: `${(aging[k] / total) * 100}%` }} /> : null,
          )}
      </div>
      <div className="aginglegend">
        {parts.map(([k, label]) => (
          <span key={k}>
            <i className={`dot seg-${k}`} /> {label}: <b>{rupees(aging[k])}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'good' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

/** Form wrapper that handles busy state and errors for async submit handlers. */
export function AsyncForm({
  onSubmit,
  children,
  submitLabel,
  className,
}: {
  onSubmit: (data: FormData) => Promise<void>;
  children: ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(new FormData(form));
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className={className ?? 'form'}>
      {children}
      <ErrorNote error={error} />
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
