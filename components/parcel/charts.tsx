'use client';
import { useMemo, useRef, useState } from 'react';
import { strategyPnl } from '@/lib/parcel/math';
import { valueChartDomain } from '@/lib/parcel/value';
import type { OptionPosition } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * The desk's small charts.
 *
 * Everything here is computed from state the client already holds —
 * the stored price history, the risk summary, the open positions. None
 * of it is illustrative. A chart on a trading screen that is not a
 * picture of real numbers is worse than no chart, because the reader
 * cannot tell which kind they are looking at.
 */

const path = (points: [number, number][]) =>
  points
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

/** A session feed is discrete, so its trace should say so. */
const steppedPath = (points: [number, number][]) =>
  points
    .map(([x, y], i) => {
      if (!i) return `M${x.toFixed(2)},${y.toFixed(2)}`;
      const [, previousY] = points[i - 1];
      return `L${x.toFixed(2)},${previousY.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

/* ---------------------------------------------------------------- */

/** A bare line, for a table cell or a card corner. */
export function Sparkline({
  values,
  width = 120,
  height = 34,
  tone = 'indicative',
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Stored closes are historical; private quotes are session marks. */
  tone?: 'reference' | 'indicative';
}) {
  if (values.length < 2) {
    return (
      <svg
        className={`od-spark tone-${tone} empty`}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
      >
        <path className="guide" d={`M3 ${height / 2} H${width - 3}`} />
      </svg>
    );
  }
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  const inset = 3;
  const points = values.map(
    (v, i) =>
      [
        inset + (i / (values.length - 1)) * (width - inset * 2),
        height - inset - ((v - min) / span) * (height - inset * 2),
      ] as [number, number],
  );
  const [lastX, lastY] = points.at(-1)!;
  return (
    <svg
      className={`od-spark tone-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <path className="guide" d={`M${inset} ${height / 2} H${width - inset}`} />
      <path className="line" d={steppedPath(points)} />
      <circle className="last" cx={lastX} cy={lastY} r="2.25" />
    </svg>
  );
}

/* ---------------------------------------------------------------- */

const P = { w: 760, h: 244, x0: 62, x1: 748, y0: 26, y1: 198, axisY: 226 };

/**
 * The underlying's stored price history.
 *
 * The desk replays a fixed window of NVDA closes, and until now nothing
 * in the product ever showed it — the reader was asked to price a
 * contract against a single number with no idea where that number sat
 * in its own range.
 */
export function PriceHistory({
  rows,
  current,
}: {
  rows: { date: string; close: number }[];
  current: string;
}) {
  const plot = useMemo(() => {
    const closes = rows.map((r) => r.close);
    const min = Math.min(...closes),
      max = Math.max(...closes);
    // A 6% cushion, so the extremes are not welded to the frame edge.
    const pad = (max - min) * 0.06 || 1;
    const lo = min - pad,
      hi = max + pad;
    const x = (i: number) =>
      P.x0 + (i / Math.max(1, rows.length - 1)) * (P.x1 - P.x0);
    const y = (v: number) => P.y0 + ((hi - v) / (hi - lo)) * (P.y1 - P.y0);
    const points = rows.map((r, i) => [x(i), y(r.close)] as [number, number]);
    const at = rows.findIndex((r) => r.date >= current.slice(0, 10));
    return {
      line: path(points),
      area: `${path(points)} L${P.x1},${P.y1} L${P.x0},${P.y1} Z`,
      grid: [0, 0.5, 1].map((n) => ({
        y: P.y0 + n * (P.y1 - P.y0),
        label: usd(hi - (hi - lo) * n, 0),
      })),
      ticks: [0, rows.length - 1].map((i) => ({
        x: x(i),
        label: rows[i].date.slice(5).replace('-', '/'),
      })),
      marker:
        at >= 0 ? { x: x(at), y: y(rows[at].close), row: rows[at] } : null,
      up: closes.at(-1)! >= closes[0],
    };
  }, [rows, current]);

  return (
    <svg
      className="od-history"
      viewBox={`0 0 ${P.w} ${P.h}`}
      aria-label="Stored NVDA closes for the replay window"
    >
      <defs>
        <linearGradient id="odHist" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--pc-cyan)" stopOpacity=".24" />
          <stop offset="1" stopColor="var(--pc-cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="od-chart-grid">
        {plot.grid.map((g) => (
          <g key={g.label}>
            <line x1={P.x0} x2={P.x1} y1={g.y} y2={g.y} />
            <text x={P.x0 - 10} y={g.y + 4} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
      </g>
      <path d={plot.area} fill="url(#odHist)" />
      <path d={plot.line} className="od-chart-line" />
      {plot.marker && (
        <g className="od-history-now">
          <line x1={plot.marker.x} x2={plot.marker.x} y1={P.y0} y2={P.y1} />
          <circle cx={plot.marker.x} cy={plot.marker.y} r="4.5" />
          {/* Pushed clear of the value column on the left; at the very
              start of the window the two labels sit on the same pixels. */}
          <text
            x={Math.max(plot.marker.x, P.x0 + 26)}
            y={P.y0 - 4}
            textAnchor={plot.marker.x > P.w * 0.7 ? 'end' : 'middle'}
          >
            {usd(plot.marker.row.close)}
          </text>
        </g>
      )}
      <g className="od-chart-ticks">
        {plot.ticks.map((t, i) => (
          <text
            key={t.label}
            x={t.x}
            y={P.axisY}
            textAnchor={i === 0 ? 'start' : 'end'}
          >
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- */

const V = { w: 760, h: 200, x0: 4, x1: 756, y0: 12, y1: 188 };

/**
 * The vault's value over the sessions on screen.
 *
 * No axes and no grid. This is the balance line above the fold, read
 * for its shape and its endpoint, and the endpoint is already printed
 * at full precision directly above it — ruling the plot would be
 * furniture around a number the reader has in front of them.
 *
 * Coloured against the first point of the drawn window, which is the
 * move the figure beside it reports.
 */
export function ValueHistory({
  points,
  label,
}: {
  points: { date: string; value: number }[];
  label: string;
}) {
  const plot = useMemo(() => {
    const values = points.map((p) => p.value);
    const { lo, hi } = valueChartDomain(points);
    const x = (i: number) =>
      V.x0 + (i / Math.max(1, points.length - 1)) * (V.x1 - V.x0);
    const y = (v: number) => V.y0 + ((hi - v) / (hi - lo)) * (V.y1 - V.y0);
    const drawn = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
    return {
      line: path(drawn),
      area: `${path(drawn)} L${V.x1},${V.y1} L${V.x0},${V.y1} Z`,
      last: drawn.at(-1)!,
      up: values.at(-1)! >= values[0],
    };
  }, [points]);

  return (
    <svg
      className={`od-value ${plot.up ? 'up' : 'down'}`}
      viewBox={`0 0 ${V.w} ${V.h}`}
      preserveAspectRatio="none"
      aria-label={label}
    >
      <defs>
        <linearGradient id="odValue" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={plot.area} fill="url(#odValue)" />
      <path d={plot.line} className="od-value-line" />
      {/* preserveAspectRatio: none stretches the viewBox, which would
          stretch a circle into an ellipse. A cross of two strokes with
          vector-effect keeps its size in screen pixels instead. */}
      <g
        className="od-value-now"
        transform={`translate(${plot.last[0]} ${plot.last[1]})`}
      >
        <line x1="-5" x2="5" y1="0" y2="0" />
        <line x1="0" x2="0" y1="-5" y2="5" />
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- */

export interface ValueTick {
  /** ms since epoch, or a sequence index when the chart has no clock. */
  t: number;
  value: number;
}

/** Venue session windows for a 1D time axis, in ms. */
export interface MarketSessions {
  pre?: { start: number; end: number } | null;
  regular?: { start: number; end: number } | null;
  post?: { start: number; end: number } | null;
}

const L = { w: 1000, h: 240, y0: 22, y1: 226 };

/**
 * The vault's value line, drawn to be read by pointing at it.
 *
 * A time axis when `domain` is given: the day runs from the first print
 * to the close, so the line grows to the right as the session goes on
 * rather than stretching to fill the width. The dashed rule is the
 * reference the move is measured from (yesterday's close on 1D). On a
 * 1D axis, pre-market / regular / after-hours bands mark the venue's
 * day so the line's shape reads against the clock. The last point
 * pulses while the feed is live; pointing anywhere scrubs the headline
 * to that moment.
 */
export function LiveValueChart({
  points,
  domain,
  baseline,
  sessions,
  live,
  label,
  onScrub,
}: {
  points: ValueTick[];
  domain?: [number, number];
  baseline?: number | null;
  /** Pre / regular / after windows; only drawn on a timed 1D domain. */
  sessions?: MarketSessions | null;
  live?: boolean;
  label: string;
  onScrub?: (point: ValueTick | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const plot = useMemo(() => {
    const values = points.map((p) => p.value);
    if (baseline != null) values.push(baseline);
    const min = Math.min(...values),
      max = Math.max(...values);
    const pad = (max - min) * 0.14 || Math.abs(max) * 0.002 || 1;
    const lo = min - pad,
      hi = max + pad;
    const [d0, d1] = domain ?? [0, Math.max(1, points.length - 1)];
    const span = Math.max(1, d1 - d0);
    const fx = (p: ValueTick, i: number) =>
      domain
        ? Math.min(1, Math.max(0, (p.t - d0) / span))
        : i / Math.max(1, d1);
    const fy = (v: number) => (hi - v) / (hi - lo);
    const xy = points.map(
      (p, i) => [fx(p, i), fy(p.value)] as [number, number],
    );
    const scaled = xy.map(
      ([x, y]) => [x * L.w, L.y0 + y * (L.y1 - L.y0)] as [number, number],
    );
    const reference = baseline ?? points[0]?.value ?? 0;
    const xAt = (t: number) =>
      Math.min(L.w, Math.max(0, ((t - d0) / span) * L.w));
    const bands: {
      id: string;
      label: string;
      x: number;
      width: number;
      kind: 'pre' | 'regular' | 'post';
    }[] = [];
    const dividers: number[] = [];
    if (domain && sessions) {
      const clip = (start: number, end: number) => {
        const a = Math.max(d0, start);
        const b = Math.min(d1, end);
        if (b <= a) return null;
        return { x: xAt(a), width: xAt(b) - xAt(a) };
      };
      if (sessions.pre) {
        const box = clip(sessions.pre.start, sessions.pre.end);
        if (box) bands.push({ id: 'pre', label: 'Pre', kind: 'pre', ...box });
      }
      if (sessions.regular) {
        const box = clip(sessions.regular.start, sessions.regular.end);
        if (box)
          bands.push({
            id: 'regular',
            label: 'Market',
            kind: 'regular',
            ...box,
          });
        if (sessions.regular.start > d0 && sessions.regular.start < d1)
          dividers.push(xAt(sessions.regular.start));
        if (sessions.regular.end > d0 && sessions.regular.end < d1)
          dividers.push(xAt(sessions.regular.end));
      }
      if (sessions.post) {
        const box = clip(sessions.post.start, sessions.post.end);
        if (box)
          bands.push({ id: 'post', label: 'After', kind: 'post', ...box });
      }
    }
    return {
      xy,
      line: path(scaled),
      area: scaled.length
        ? `${path(scaled)} L${scaled.at(-1)![0]},${L.h} L${scaled[0][0]},${L.h} Z`
        : '',
      base: baseline != null ? L.y0 + fy(baseline) * (L.y1 - L.y0) : null,
      up: (points.at(-1)?.value ?? 0) >= reference,
      bands,
      dividers,
    };
  }, [points, domain, baseline, sessions]);

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !plot.xy.length) return;
    const fx = (clientX - r.left) / r.width;
    let best = 0;
    for (let i = 1; i < plot.xy.length; i++)
      if (Math.abs(plot.xy[i][0] - fx) < Math.abs(plot.xy[best][0] - fx))
        best = i;
    setHover(best);
    onScrub?.(points[best]);
  };
  const leave = () => {
    setHover(null);
    onScrub?.(null);
  };

  const at = hover ?? plot.xy.length - 1;
  const dot = plot.xy[at];
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  const yPct = (y: number) => pct((L.y0 + y * (L.y1 - L.y0)) / L.h);

  return (
    <div
      ref={box}
      className={`od-vline ${plot.up ? 'up' : 'down'}`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={leave}
    >
      <svg
        viewBox={`0 0 ${L.w} ${L.h}`}
        preserveAspectRatio="none"
        aria-label={label}
      >
        <defs>
          <linearGradient id="odVline" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {plot.bands.map((band) => (
          <g key={band.id} className={`od-vline-band ${band.kind}`}>
            <rect x={band.x} y={0} width={band.width} height={L.h} />
            {band.width > 48 && (
              <text
                x={band.x + band.width / 2}
                y={12}
                textAnchor="middle"
              >
                {band.label}
              </text>
            )}
          </g>
        ))}
        {plot.dividers.map((x) => (
          <line
            key={x}
            className="od-vline-session"
            x1={x}
            x2={x}
            y1={0}
            y2={L.h}
          />
        ))}
        {plot.base != null && (
          <line
            className="od-vline-base"
            x1="0"
            x2={L.w}
            y1={plot.base}
            y2={plot.base}
          />
        )}
        <path d={plot.area} fill="url(#odVline)" />
        <path d={plot.line} className="od-vline-line" />
      </svg>
      {hover != null && dot && (
        <i className="od-vline-rule" style={{ left: pct(dot[0]) }} />
      )}
      {dot && (
        <b
          className={`od-vline-dot ${live && hover == null ? 'pulse' : ''}`}
          style={{ left: pct(dot[0]), top: yPct(dot[1]) }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const R = { w: 880, h: 300, x0: 60, x1: 858, y0: 26, y1: 246, axisY: 276 };

/**
 * The borrow and supply curves, across the whole utilisation range.
 *
 * The two-slope model is the only thing on the lending screen that a
 * reader cannot work out from a number: the borrow rate is gentle up
 * to the optimal point and then turns almost vertical, and the supply
 * rate trails it by utilisation and the reserve factor. Printing "3.50%
 * APR" says nothing about the cliff a few points to the right.
 */
export function RateCurve({
  curve,
  at,
  optimal,
}: {
  curve: { u: number; borrow: number; supply: number }[];
  /** Where the pool is sitting now. */
  at: { u: number; borrow: number; supply: number };
  /** Aave kink — where slope1 hands off to slope2. */
  optimal?: number;
}) {
  const plot = useMemo(() => {
    const top = Math.max(...curve.map((p) => p.borrow), at.borrow) * 1.08 || 1;
    const x = (u: number) => R.x0 + u * (R.x1 - R.x0);
    const y = (v: number) => R.y1 - (v / top) * (R.y1 - R.y0);
    const line = (k: 'borrow' | 'supply') =>
      path(curve.map((p) => [x(p.u), y(p[k])] as [number, number]));
    const kink =
      optimal != null && optimal > 0 && optimal < 1
        ? {
            x: x(optimal),
            borrow: y(
              curve.find((p) => Math.abs(p.u - optimal) < 0.006)?.borrow ??
                at.borrow,
            ),
          }
        : null;
    return {
      borrow: line('borrow'),
      supply: line('supply'),
      grid: [0, 0.5, 1].map((n) => ({
        y: R.y1 - n * (R.y1 - R.y0),
        label: `${(top * n * 100).toFixed(1)}%`,
      })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((u) => ({
        x: x(u),
        label: `${u * 100}%`,
      })),
      now: { x: x(at.u), borrow: y(at.borrow), supply: y(at.supply) },
      kink,
      optimal,
    };
  }, [curve, at, optimal]);

  return (
    <svg
      className="od-rates"
      viewBox={`0 0 ${R.w} ${R.h}`}
      aria-label={`Borrow and supply rates across utilisation, currently ${(at.u * 100).toFixed(1)}% utilised${optimal != null ? `, optimal ${(optimal * 100).toFixed(0)}%` : ''}`}
    >
      <g className="od-chart-grid">
        {plot.grid.map((g) => (
          <g key={g.label}>
            <line x1={R.x0} x2={R.x1} y1={g.y} y2={g.y} />
            <text x={R.x0 - 10} y={g.y + 4} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
      </g>
      {plot.kink && (
        <g className="od-rates-kink">
          <line
            x1={plot.kink.x}
            x2={plot.kink.x}
            y1={R.y0}
            y2={R.y1}
          />
          <text x={plot.kink.x} y={R.y0 - 6} textAnchor="middle">
            Optimal {(plot.optimal! * 100).toFixed(0)}%
          </text>
        </g>
      )}
      <path d={plot.supply} className="od-rates-supply" />
      <path d={plot.borrow} className="od-rates-borrow" />
      <g className="od-rates-now">
        <line x1={plot.now.x} x2={plot.now.x} y1={R.y0} y2={R.y1} />
        <circle cx={plot.now.x} cy={plot.now.borrow} r="4.5" />
        <circle cx={plot.now.x} cy={plot.now.supply} r="4.5" className="sup" />
      </g>
      <g className="od-chart-ticks">
        {plot.ticks.map((t, i) => (
          <text
            key={t.label}
            x={t.x}
            y={R.axisY}
            textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
          >
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/**
 * Allocation, as a ring.
 *
 * Drawn from arcs rather than a conic-gradient so the segments can
 * carry a gap between them; two adjacent conic stops meet on a hard
 * edge that reads as one continuous band.
 */
export function Donut({
  slices,
  centre,
  caption,
}: {
  slices: Slice[];
  centre: string;
  caption: string;
}) {
  const total = slices.reduce((t, s) => t + Math.max(0, s.value), 0);
  const R = 52,
    C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="od-donut">
      <svg viewBox="0 0 140 140" aria-hidden>
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--pc-raised)"
          strokeWidth="15"
        />
        {total > 0 &&
          slices.map((s) => {
            const share = Math.max(0, s.value) / total;
            const dash = `${Math.max(0, share * C - 2)} ${C}`;
            const node = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={dash}
                strokeDashoffset={-offset * C}
                transform="rotate(-90 70 70)"
              />
            );
            offset += share;
            return node;
          })}
      </svg>
      <div className="od-donut-centre">
        <strong>{centre}</strong>
        <small>{caption}</small>
      </div>
    </div>
  );
}

/** The legend that goes with it, also usable on its own. */
export function Legend({ slices }: { slices: (Slice & { note: string })[] }) {
  return (
    <ul className="od-legend">
      {slices.map((s) => (
        <li key={s.label}>
          <i style={{ background: s.color }} />
          <span>{s.label}</span>
          <b>{s.note}</b>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- */

const B = { w: 760, h: 230, x0: 62, x1: 748, y0: 16, y1: 186, axisY: 212 };

/**
 * What the whole book does at expiry.
 *
 * Every open contract plus the shares in the vault, summed at each
 * price. A reader with four positions cannot hold their combined shape
 * in their head, and this is the one number that actually answers
 * "what happens if it gaps".
 */
export function BookPayoff({
  positions,
  shares,
  spot,
}: {
  positions: OptionPosition[];
  shares: number;
  spot: number;
}) {
  const plot = useMemo(() => {
    const strikes = positions.flatMap((p) =>
      p.terms.curve
        ? [p.terms.curve.lower, p.terms.curve.upper]
        : p.terms.legs.map((l) => l.strike),
    );
    const lo = Math.min(spot * 0.7, ...strikes.map((k) => k * 0.85));
    const hi = Math.max(spot * 1.3, ...strikes.map((k) => k * 1.15));
    const rows = Array.from({ length: 121 }, (_, i) => {
      const price = lo + ((hi - lo) * i) / 120;
      const pnl =
        positions.reduce(
          (t, p) => t + strategyPnl(p.terms, price, spot, p.premium, 0),
          0,
        ) +
        shares * (price - spot);
      return { price, pnl };
    });
    const min = Math.min(-1e-9, ...rows.map((r) => r.pnl));
    const max = Math.max(1e-9, ...rows.map((r) => r.pnl));
    const span = max - min;
    const x = (v: number) => B.x0 + ((v - lo) / (hi - lo)) * (B.x1 - B.x0);
    const y = (v: number) => B.y0 + ((max - v) / span) * (B.y1 - B.y0);
    return {
      line: path(rows.map((r) => [x(r.price), y(r.pnl)] as [number, number])),
      zeroY: y(0),
      x,
      spot,
      grid: [0, 0.25, 0.5, 0.75, 1].map((n) => ({
        y: B.y0 + n * (B.y1 - B.y0),
        label: usd(max - span * n, span < 10 ? 2 : 0),
      })),
      ticks: [lo, (lo + hi) / 2, hi].map((p) => ({
        x: x(p),
        label: usd(p, 0),
      })),
      atSpot: rows.reduce((best, r) =>
        Math.abs(r.price - spot) < Math.abs(best.price - spot) ? r : best,
      ),
    };
  }, [positions, shares, spot]);

  return (
    <svg
      className="od-book-payoff"
      viewBox={`0 0 ${B.w} ${B.h}`}
      aria-label="Combined profit and loss of every open position at expiry"
    >
      <defs>
        <linearGradient id="odBookUp" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--pc-up)" stopOpacity=".24" />
          <stop offset="1" stopColor="var(--pc-up)" stopOpacity="0" />
        </linearGradient>
        <clipPath id="odBookClip">
          <rect
            x={B.x0}
            y={B.y0}
            width={B.x1 - B.x0}
            height={Math.max(0, plot.zeroY - B.y0)}
          />
        </clipPath>
      </defs>
      <g className="od-chart-grid">
        {plot.grid.map((g) => (
          <g key={g.label}>
            <line x1={B.x0} x2={B.x1} y1={g.y} y2={g.y} />
            <text x={B.x0 - 10} y={g.y + 4} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
      </g>
      <path
        d={`${plot.line} L${B.x1},${plot.zeroY} L${B.x0},${plot.zeroY} Z`}
        fill="url(#odBookUp)"
        clipPath="url(#odBookClip)"
      />
      <line
        className="od-chart-zero"
        x1={B.x0}
        x2={B.x1}
        y1={plot.zeroY}
        y2={plot.zeroY}
      />
      <path d={plot.line} className="od-chart-line" />
      <g className="od-chart-spot">
        <line x1={plot.x(spot)} x2={plot.x(spot)} y1={B.y0} y2={B.y1} />
      </g>
      <g className="od-chart-ticks">
        {plot.ticks.map((t, i) => (
          <text
            key={t.label + i}
            x={t.x}
            y={B.axisY}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          >
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- */

/** A labelled horizontal bar, for anything measured against a total. */
export function Meter({
  label,
  value,
  of,
  note,
  color = 'var(--pc-cyan)',
}: {
  label: string;
  value: number;
  of: number;
  note?: string;
  color?: string;
}) {
  const share = of > 0 ? Math.min(1, Math.max(0, value / of)) : 0;
  return (
    <div className="od-meter">
      <div className="od-meter-top">
        <span>{label}</span>
        <b>{note ?? usd(value)}</b>
      </div>
      <div className="od-meter-track">
        <i style={{ width: `${share * 100}%`, background: color }} />
      </div>
    </div>
  );
}
