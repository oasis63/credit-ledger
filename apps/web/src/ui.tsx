import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';
import type { Aging, RiskFlag } from './api';
import { rupees } from './format';

// ---------- toasts ----------
type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{t.text}</span>
            <button className="icon-btn" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- layout blocks ----------
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${pad ? '' : 'card-flush'} ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'brand'; icon?: ReactNode }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={22} />}</div>
      <b>{title}</b>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading"><Loader2 size={18} className="spin" />{label}</div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <div className="alert alert-error" role="alert"><AlertTriangle size={16} />{error}</div> : null;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode; count?: number }> }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size = 'md' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay overlay-right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </div>
  );
}

// ---------- domain bits ----------
export function RiskBadge({ flag, title }: { flag: RiskFlag; title?: string }) {
  const label = { green: 'Good', amber: 'Watch', red: 'Stop credit' }[flag];
  return <span className={`badge badge-${flag}`} title={title}><i />{label}</span>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Money({ paise, tone, strong }: { paise: number; tone?: 'auto' | 'bad' | 'good'; strong?: boolean }) {
  const cls = tone === 'auto' ? (paise > 0 ? 'neg' : paise < 0 ? 'pos' : '') : tone === 'bad' ? 'neg' : tone === 'good' ? 'pos' : '';
  return <span className={`money ${cls} ${strong ? 'strong' : ''}`}>{rupees(paise)}</span>;
}

export const AGING_PARTS: Array<[keyof Aging, string]> = [
  ['not_due', 'Not due'],
  ['d1_30', '1–30 days'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90_plus', '90+'],
];

export function AgingBar({ aging, legend = true }: { aging: Aging; legend?: boolean }) {
  const total = AGING_PARTS.reduce((s, [k]) => s + aging[k], 0);
  return (
    <div>
      <div className="agingbar" role="img" aria-label="Receivables by age">
        {total > 0 && AGING_PARTS.map(([k]) => (aging[k] > 0 ? <span key={k} className={`seg-${k}`} style={{ width: `${(aging[k] / total) * 100}%` }} /> : null))}
      </div>
      {legend && (
        <div className="aging-legend">
          {AGING_PARTS.map(([k, label]) => (
            <div key={k}>
              <span><i className={`dot seg-${k}`} />{label}</span>
              <b>{rupees(aging[k])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const t = tone ?? (pct >= 100 ? 'good' : pct >= 60 ? 'warn' : 'bad');
  return (
    <div className="progress" aria-label={`${pct}%`}>
      <span className={`progress-${t}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({ label, hint, children, span }: { label: string; hint?: ReactNode; children: ReactNode; span?: 2 | 3 }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 70% 94%)`, color: `hsl(${h} 45% 35%)` }}>
      {initials || '?'}
    </span>
  );
}

/** Button that runs an async action, shows a spinner and reports errors as a toast. */
export function ActionButton({ onClick, children, className = 'btn', disabled, title, okText }: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  okText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      className={className}
      title={title}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
          if (okText) toast(okText);
        } catch (e) {
          toast((e as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 size={15} className="spin" />}
      {children}
    </button>
  );
}
