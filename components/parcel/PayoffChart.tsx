'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bounded, orderGreeks, strategyPnl } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * The payoff chart.
 *
 * Drawn at the size it is shown, not scaled from a fixed viewBox: the
 * plot fills whatever height its column gives it, and its type stays the
 * same size at any width. Colour does the explaining — the line and the
 * fill are green where the position makes money and red where it loses —
 * and the dashed line is what the same position is worth today, so the
 * reader sees both where it ends and how it gets there.
 *
 * The numbers a reader looks for (break-even, the most it can make, the
 * most it can lose) sit in one line under the headline instead of
 * floating on the plot, and pointing anywhere reads the curve there.
 */

const SAMPLES = 181;

/** Round gridline values — 1, 2, 2.5 or 5 times a power of ten — through zero. */
function niceTicks(min: number, max: number, target = 5) {
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toFixed(10)));
  return out;
}
const tickDp = (span: number) => (span < 0.5 ? 3 : span < 20 ? 2 : 0);
const PAD = { left: 58, right: 16, top: 30, bottom: 30 };

export function PayoffChart({
  terms,
  premium,
  spot,
  stockQuantity = 0,
  shock,
  onShock,
  date,
  vol,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
  stockQuantity?: number;
  /** Lifted when a parent wants the scrubber to survive a re-mount. */
  shock?: number;
  onShock?: (next: number) => void;
  /** With a date and a volatility, the chart also draws today's value. */
  date?: string;
  vol?: number;
}) {
  const uid = useId().replaceAll(':', '');
  const [ownShock, setOwnShock] = useState(0);
  // The control is intentionally constrained to the price domain that is
  // actually drawn. Previously the slider allowed ±60% while a typical
  // payoff view showed only ±30%, which meant its cursor could be rendered
  // outside the chart. Keep the scenario, its marker and the plotted scale
  // in one shared coordinate system.
  const requestedMove = shock ?? ownShock;
  const setMove = onShock ?? setOwnShock;
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Nothing is drawn until the box has been measured: a guessed size
  // drawn first and then corrected animates the whole curve sideways.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !('ResizeObserver' in window)) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plot = useMemo(() => {
    const { w, h } = size ?? { w: 720, h: 300 };
    const x0 = PAD.left,
      x1 = w - PAD.right,
      y0 = PAD.top,
      y1 = h - PAD.bottom;
    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((l) => l.strike);
    const low = Math.min(...strikes),
      high = Math.max(...strikes);
    const lo = Math.min(spot * 0.7, low * 0.88);
    const hi = Math.max(spot * 1.3, high * 1.12);
    const priceAt = (i: number) => lo + ((hi - lo) * i) / (SAMPLES - 1);
    const rows = Array.from({ length: SAMPLES }, (_, i) => {
      const price = priceAt(i);
      return {
        price,
        pnl: strategyPnl(terms, price, spot, premium, stockQuantity),
      };
    });
    const now =
      date && vol && terms.reference === 'stock'
        ? Array.from({ length: 91 }, (_, i) => {
            const price = lo + ((hi - lo) * i) / 90;
            return {
              price,
              pnl:
                orderGreeks(terms, price, date, vol).price -
                premium +
                stockQuantity * (price - spot),
            };
          })
        : null;

    const all = [...rows, ...(now ?? [])].map((r) => r.pnl);
    let min = Math.min(0, ...all),
      max = Math.max(0, ...all);
    const room = (max - min || Math.abs(premium) || 1) * 0.08;
    min -= room;
    max += room;
    const span = max - min;
    const x = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    const y = (v: number) => y0 + ((max - v) / span) * (y1 - y0);
    const path = (list: { price: number; pnl: number }[]) =>
      list
        .map(
          (r, i) =>
            `${i ? 'L' : 'M'}${x(r.price).toFixed(1)},${y(r.pnl).toFixed(1)}`,
        )
        .join(' ');

    const crossings: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (a.pnl === 0 || a.pnl < 0 === b.pnl < 0) continue;
      crossings.push(
        a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl)),
      );
    }

    // The ends of the sampled range say whether a side keeps going.
    const pnls = rows.map((r) => r.pnl);
    const rising = pnls.at(-1)! - pnls.at(-2)! > 1e-9;
    const falling = pnls.at(-1)! - pnls.at(-2)! < -1e-9;
    const open = !terms.curve && !bounded(terms.legs);
    const best = open && rising ? Infinity : Math.max(...pnls);
    const worst = open && falling ? -Infinity : Math.min(...pnls);

    const line = path(rows);
    return {
      w,
      h,
      x0,
      x1,
      y0,
      y1,
      lo,
      hi,
      x,
      y,
      line,
      area: `${line} L${x1},${y(0)} L${x0},${y(0)} Z`,
      now: now ? path(now) : null,
      zeroY: y(0),
      crossings,
      best,
      worst,
      strikes: [...new Set(strikes)].sort((a, b) => a - b),
      grid: niceTicks(min, max).map((v) => ({
        y: y(v),
        label: `${v < 0 ? '−' : ''}${usd(Math.abs(v), tickDp(max - min))}`,
      })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((n) => {
        const price = lo + (hi - lo) * n;
        return { x: x(price), label: usd(price, hi - lo < 1 ? 3 : 0) };
      }),
    };
  }, [terms, premium, spot, stockQuantity, date, vol, size]);

  const minMove = Math.min(
    0,
    Math.max(-60, Math.ceil(((plot.lo / spot - 1) * 100) / 0.5) * 0.5),
  );
  const maxMove = Math.max(
    0,
    Math.min(60, Math.floor(((plot.hi / spot - 1) * 100) / 0.5) * 0.5),
  );
  const move = Math.min(maxMove, Math.max(minMove, requestedMove));
  const clampMove = (next: number) =>
    Math.round(Math.min(maxMove, Math.max(minMove, next)) * 10) / 10;

  const cents = plot.hi - plot.lo < 1 ? 4 : 2;
  const dp = terms.reference === 'dividend' ? 4 : 2;
  const reading = hover ?? spot * (1 + move / 100);
  const pnl = strategyPnl(terms, reading, spot, premium, stockQuantity);
  const cx = plot.x(reading),
    cy = plot.y(pnl);
  const away = (reading / spot - 1) * 100;

  const priceAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    const px = Math.min(plot.x1, Math.max(plot.x0, clientX - r.left));
    return (
      plot.lo + ((px - plot.x0) / (plot.x1 - plot.x0)) * (plot.hi - plot.lo)
    );
  };
  const signed = (n: number) =>
    n === Infinity
      ? 'Unlimited'
      : n === -Infinity
        ? 'Unlimited'
        : `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${usd(Math.abs(n), dp)}`;
  const spotX = plot.x(spot);
  // Labels that would print on top of each other: keep the first of a
  // crowded pair, and move the spot label to the foot of the plot when
  // the band above it is taken.
  const labelled = plot.strikes.filter(
    (k, i, all) => i === 0 || plot.x(k) - plot.x(all[i - 1]) >= 42,
  );
  const spotClash = labelled.some((k) => Math.abs(plot.x(k) - spotX) < 56);

  return (
    <div className="od-payoff">
      <div className="od-payoff-head">
        <div>
          <span>{stockQuantity ? 'Stock and options' : 'Profit and loss'}</span>
          <b>At expiry</b>
        </div>
        <div className="od-payoff-read">
          <b className={pnl >= 0 ? 'up' : 'down'}>{signed(pnl)}</b>
          <span>
            if {terms.symbol} is {usd(reading, cents)}
            {Math.abs(away) >= 0.05
              ? ` (${away > 0 ? '+' : ''}${away.toFixed(1)}%)`
              : ' (current price)'}
          </span>
        </div>
      </div>

      <div className="od-payoff-meta">
        <dl className="od-payoff-stats">
          <div>
            <dt>Break-even</dt>
            <dd>
              {plot.crossings.length
                ? plot.crossings.map((p) => usd(p, cents)).join(' / ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Max profit</dt>
            <dd className="up">{signed(plot.best)}</dd>
          </div>
          <div>
            <dt>Max loss</dt>
            <dd className="down">{signed(plot.worst)}</dd>
          </div>
        </dl>
        {plot.now && (
          <div className="od-payoff-legend">
            <span>
              <i className="expiry" />
              At expiry
            </span>
            <span>
              <i className="today" />
              Value today
            </span>
          </div>
        )}
      </div>

      <div
        ref={box}
        className="od-payoff-plot"
        onPointerMove={(e) => setHover(priceAt(e.clientX))}
        onPointerDown={(e) => {
          const p = priceAt(e.clientX);
          if (p == null) return;
          setHover(p);
          setMove(clampMove((p / spot - 1) * 100));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {size && (
          <svg
            width={plot.w}
            height={plot.h}
            aria-label="Option profit and loss across underlying prices"
            className="od-payoff-svg"
          >
            <defs>
              <linearGradient id={`${uid}up`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--pc-up)" stopOpacity=".32" />
                <stop offset="1" stopColor="var(--pc-up)" stopOpacity=".03" />
              </linearGradient>
              <linearGradient id={`${uid}dn`} x1="0" x2="0" y1="1" y2="0">
                <stop offset="0" stopColor="var(--pc-down)" stopOpacity=".3" />
                <stop offset="1" stopColor="var(--pc-down)" stopOpacity=".03" />
              </linearGradient>
              <clipPath id={`${uid}above`}>
                <rect
                  x={0}
                  y={0}
                  width={plot.w}
                  height={Math.max(0, plot.zeroY)}
                />
              </clipPath>
              <clipPath id={`${uid}below`}>
                <rect
                  x={0}
                  y={plot.zeroY}
                  width={plot.w}
                  height={Math.max(0, plot.h - plot.zeroY)}
                />
              </clipPath>
            </defs>

            <g className="od-chart-grid">
              {plot.grid.map((g) => (
                <g key={g.label + g.y}>
                  <line x1={plot.x0} x2={plot.x1} y1={g.y} y2={g.y} />
                  <text x={plot.x0 - 10} y={g.y + 4} textAnchor="end">
                    {g.label}
                  </text>
                </g>
              ))}
            </g>

            <g className="od-chart-strikes">
              {plot.strikes.map((k) => (
                <g key={k}>
                  <line
                    x1={plot.x(k)}
                    x2={plot.x(k)}
                    y1={plot.y0}
                    y2={plot.y1}
                  />
                  {labelled.includes(k) && (
                    <text x={plot.x(k)} y={plot.y0 - 12} textAnchor="middle">
                      {usd(k, k < 1 ? 3 : k % 1 ? 2 : 0)}
                    </text>
                  )}
                </g>
              ))}
            </g>

            <path
              d={plot.area}
              fill={`url(#${uid}up)`}
              clipPath={`url(#${uid}above)`}
              className="od-chart-area"
            />
            <path
              d={plot.area}
              fill={`url(#${uid}dn)`}
              clipPath={`url(#${uid}below)`}
              className="od-chart-area"
            />
            <line
              className="od-chart-zero"
              x1={plot.x0}
              x2={plot.x1}
              y1={plot.zeroY}
              y2={plot.zeroY}
            />
            {plot.now && <path d={plot.now} className="od-chart-now" />}
            <path
              d={plot.line}
              className="od-chart-line up"
              clipPath={`url(#${uid}above)`}
            />
            <path
              d={plot.line}
              className="od-chart-line down"
              clipPath={`url(#${uid}below)`}
            />

            {plot.crossings.map((p) => (
              <circle
                key={p}
                className="od-chart-be"
                cx={plot.x(p)}
                cy={plot.zeroY}
                r="3.5"
              />
            ))}

            <g className="od-chart-spot">
              <line x1={spotX} x2={spotX} y1={plot.y0} y2={plot.y1} />
              <text
                x={spotX}
                y={spotClash ? plot.y1 - 8 : plot.y0 - 12}
                textAnchor="middle"
              >
                Now {usd(spot, cents)}
              </text>
            </g>

            <g className="od-chart-cursor">
              <line x1={cx} x2={cx} y1={plot.y0} y2={plot.y1} />
              <circle
                cx={cx}
                cy={cy}
                r="5"
                className={pnl >= 0 ? 'up' : 'down'}
              />
            </g>

            <g className="od-chart-ticks">
              {plot.ticks.map((t, i) => (
                <text
                  key={t.label + i}
                  x={t.x}
                  y={plot.h - 8}
                  textAnchor={
                    i === 0
                      ? 'start'
                      : i === plot.ticks.length - 1
                        ? 'end'
                        : 'middle'
                  }
                >
                  {t.label}
                </text>
              ))}
            </g>
          </svg>
        )}
      </div>

      <label className="od-chart-slider">
        <span>Price move</span>
        <input
          aria-label="Reference price move"
          type="range"
          min={minMove}
          max={maxMove}
          step="0.5"
          value={move}
          onChange={(e) => setMove(clampMove(Number(e.target.value)))}
        />
        <b>
          {move > 0 ? '+' : ''}
          {move}%
        </b>
      </label>

      {stockQuantity > 0 && (
        <p className="od-note">
          Includes {stockQuantity} {terms.symbol} acquired at {usd(spot)}.
        </p>
      )}
    </div>
  );
}
