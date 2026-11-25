import { useMemo, useState } from 'react';
import { rupees } from './format';

const compact = (paise: number) => {
  const r = paise / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`;
  return `₹${Math.round(r)}`;
};
export { compact as compactRupees };

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Bars (collected) with a line (billed) over days. Hover shows the day's numbers. */
export function TrendChart({ days, height = 240 }: { days: Array<{ date: string; collected_paise: number; billed_paise: number }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 52, r: 12, t: 12, b: 26 };
  const max = useMemo(() => niceMax(Math.max(1, ...days.map((d) => Math.max(d.collected_paise, d.billed_paise)))), [days]);
  const n = days.length || 1;
  const bw = (W - pad.l - pad.r) / n;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${pad.l + bw * i + bw / 2},${y(d.billed_paise)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(n / 8);
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" onMouseLeave={() => setHover(null)} role="img" aria-label="Collections and billing by day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + bw * i} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
            <rect
              x={pad.l + bw * i + bw * 0.18}
              y={y(d.collected_paise)}
              width={Math.max(1, bw * 0.64)}
              height={Math.max(0, H - pad.b - y(d.collected_paise))}
              rx={Math.min(4, bw * 0.2)}
              className={`bar ${hover === i ? 'bar-hot' : ''}`}
            />
            {i % labelEvery === 0 && (
              <text x={pad.l + bw * i + bw / 2} y={H - 8} className="axis" textAnchor="middle">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </text>
            )}
          </g>
        ))}
        <path d={line} className="line" />
        {hover !== null && <line x1={pad.l + bw * hover + bw / 2} x2={pad.l + bw * hover + bw / 2} y1={pad.t} y2={H - pad.b} className="cursor" />}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${((pad.l + bw * hover! + bw / 2) / W) * 100}%` }}>
          <b>{new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
          <span><i className="dot dot-brand" />Collected {rupees(h.collected_paise)}</span>
          <span><i className="dot dot-line" />Billed {rupees(h.billed_paise)}</span>
        </div>
      )}
      <div className="chart-legend"><span><i className="dot dot-brand" />Collected</span><span><i className="dot dot-line" />Billed</span></div>
    </div>
  );
}

/** Donut chart with a centre label. */
export function Donut({ parts, size = 160, label, sub }: { parts: Array<{ value: number; className: string; label: string }>; size?: number; label?: string; sub?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 15.915; // circumference 100
  let offset = 25;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 42 42" width={size} height={size} className="donut" role="img" aria-label={label}>
        <circle cx="21" cy="21" r={r} className="donut-track" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * 100;
            const el = <circle key={p.label} cx="21" cy="21" r={r} className={`donut-seg ${p.className}`} strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offset} />;
            offset -= len;
            return el;
          })}
        {label && <text x="21" y={sub ? 20.5 : 22.5} className="donut-label" textAnchor="middle">{label}</text>}
        {sub && <text x="21" y="25.5" className="donut-sub" textAnchor="middle">{sub}</text>}
      </svg>
    </div>
  );
}

/** Horizontal bars with labels and values. */
export function BarList({ items, format = rupees }: { items: Array<{ label: string; value: number; hint?: string }>; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i) => (
        <div key={i.label} className="barlist-row">
          <div className="barlist-bar" style={{ width: `${(i.value / max) * 100}%` }} />
          <span className="barlist-label">{i.label}{i.hint && <small>{i.hint}</small>}</span>
          <span className="barlist-value">{format(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`);
  return (
    <svg width={width} height={height} className="spark" aria-hidden>
      <polyline points={`0,${height} ${pts.join(' ')} ${width},${height}`} className="spark-fill" />
      <polyline points={pts.join(' ')} className="spark-line" />
    </svg>
  );
}
