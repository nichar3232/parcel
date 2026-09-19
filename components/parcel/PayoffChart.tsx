'use client';
import { useId, useMemo, useRef, useState } from 'react';
import { strategyPnl } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * The expiry payoff chart.
 *
 * The frame is one object. Every gridline, tick, strike rule and label
 * is positioned from it, which is the whole fix for the old chart: it
 * drew its plot between two hardcoded numbers and its axis between two
 * others, so the labels sat a few units off the line they described and
 * the curve ran out of the top of the box.
 *
 * Colour does the explaining. The region above the zero rule is filled
 * in gain, the region below it in loss, and the reader gets the answer
 * to "where do I make money" before reading a single number. The line
 * itself stays neutral so the two fills are the only thing carrying
 * meaning.
 */
/* Drawn wider than it is tall. The frame scales to the column, so a
   2.5:1 plot in a full-width column was 430px of chart and pushed its
   own reference-move row off the bottom of the screen; the reader
   could not see the whole picture at once, which is the entire job of
   a payoff chart. Every vertical below is the old one scaled. */
const F = {
  w: 880,
  h: 272,
  x0: 68,
  x1: 858,
  /** the band above the plot, where the strike labels live */
  y0: 32,
  y1: 228,
  axisY: 254,
} as const;

const SAMPLES = 161;

export function PayoffChart({
  terms,
  premium,
  spot,
  stockQuantity = 0,
  shock,
  onShock,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
  stockQuantity?: number;
  /** Lifted when a parent wants the scrubber to survive a re-mount. */
  shock?: number;
  onShock?: (next: number) => void;
}) {
  const uid = useId().replaceAll(':', '');
  const [ownShock, setOwnShock] = useState(0);
  const move = shock ?? ownShock;
  const setMove = onShock ?? setOwnShock;
  const svg = useRef<SVGSVGElement>(null);

  const plot = useMemo(() => {
    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((l) => l.strike);
    const low = Math.min(...strikes),
      high = Math.max(...strikes);
    const lo = Math.min(spot * 0.65, low * 0.85);
    const hi = Math.max(spot * 1.35, high * 1.15);
    const rows = Array.from({ length: SAMPLES }, (_, i) => {
      const price = lo + ((hi - lo) * i) / (SAMPLES - 1);
      return {
        price,
        pnl: strategyPnl(terms, price, spot, premium, stockQuantity),
      };
    });

    const min = Math.min(-1e-9, ...rows.map((r) => r.pnl));
    const max = Math.max(1e-9, ...rows.map((r) => r.pnl));
    const span = max - min;
    const x = (v: number) => F.x0 + ((v - lo) / (hi - lo)) * (F.x1 - F.x0);
    const y = (v: number) => F.y0 + ((max - v) / span) * (F.y1 - F.y0);

    // Enough precision to separate two gridlines, and no more. A chart
    // whose whole range is eleven cents needs three decimals; one that
    // spans four hundred dollars needs none.
    const step = span / 4;
    const dp =
      step < 0.02 ? 4 : step < 0.2 ? 3 : step < 2 ? 2 : step < 20 ? 1 : 0;

    const line = rows
      .map(
        (r, i) =>
          `${i ? 'L' : 'M'}${x(r.price).toFixed(2)},${y(r.pnl).toFixed(2)}`,
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

    return {
      lo,
      hi,
      rows,
      min,
      max,
      x,
      y,
      dp,
      line,
      crossings,
      zeroY: y(0),
      strikes: [...new Set(strikes)].sort((a, b) => a - b),
      grid: [0, 0.25, 0.5, 0.75, 1].map((n) => ({
        y: F.y0 + n * (F.y1 - F.y0),
        label: usd(max - span * n, dp),
      })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((n) => {
        const price = lo + (hi - lo) * n;
        return { x: x(price), label: usd(price, hi - lo < 1 ? 3 : 0) };
      }),
    };
  }, [terms, premium, spot, stockQuantity]);

  const selected = spot * (1 + move / 100);
  const pnl = strategyPnl(terms, selected, spot, premium, stockQuantity);
  const cx = plot.x(selected),
    cy = plot.y(pnl);
  const dp = terms.reference === 'dividend' ? 4 : 2;

  /** Map a pointer anywhere over the plot onto the shock slider. */
  const scrub = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((clientX - box.left) / box.width) * F.w;
    const price =
      plot.lo +
      ((Math.min(F.x1, Math.max(F.x0, vx)) - F.x0) / (F.x1 - F.x0)) *
        (plot.hi - plot.lo);
    setMove(
      Math.round(Math.min(60, Math.max(-60, (price / spot - 1) * 100)) * 10) /
        10,
    );
  };

  return (
    <div className="od-payoff">
      <div className="od-payoff-head">
        <div>
          <span>{stockQuantity ? 'Stock and options' : 'Options only'}</span>
          <b>P&amp;L at expiry</b>
        </div>
        <div className="od-payoff-read">
          <span>
            At {usd(selected, plot.hi - plot.lo < 1 ? 4 : 2)}
            {move ? ` (${move > 0 ? '+' : ''}${move}%)` : ' (spot)'}
          </span>
          <b className={pnl >= 0 ? 'up' : 'down'}>
            {pnl > 0 ? '+' : ''}
            {usd(pnl, dp)}
          </b>
        </div>
      </div>

      <svg
        ref={svg}
        viewBox={`0 0 ${F.w} ${F.h}`}
        aria-label="Option profit and loss across underlying prices"
        className="od-payoff-svg"
        onPointerMove={(e) => e.buttons !== 2 && scrub(e.clientX)}
        onPointerDown={(e) => scrub(e.clientX)}
      >
        <defs>
          <linearGradient id={`${uid}up`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--pc-up)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--pc-up)" stopOpacity=".02" />
          </linearGradient>
          <linearGradient id={`${uid}dn`} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="var(--pc-down)" stopOpacity=".26" />
            <stop offset="1" stopColor="var(--pc-down)" stopOpacity=".02" />
          </linearGradient>
          {/* The fills are the same area path, clipped to the half of
              the plot on their side of the zero rule. */}
          <clipPath id={`${uid}above`}>
            <rect
              x={F.x0}
              y={F.y0 - 2}
              width={F.x1 - F.x0}
              height={Math.max(0, plot.zeroY - F.y0 + 2)}
            />
          </clipPath>
          <clipPath id={`${uid}below`}>
            <rect
              x={F.x0}
              y={plot.zeroY}
              width={F.x1 - F.x0}
              height={Math.max(0, F.y1 - plot.zeroY + 2)}
            />
          </clipPath>
        </defs>

        <g className="od-chart-grid">
          {plot.grid.map((g) => (
            <g key={g.label + g.y}>
              <line x1={F.x0} x2={F.x1} y1={g.y} y2={g.y} />
              <text x={F.x0 - 12} y={g.y + 4} textAnchor="end">
                {g.label}
              </text>
            </g>
          ))}
        </g>

        <g className="od-chart-strikes">
          {plot.strikes.map((k) => (
            <g key={k}>
              <line x1={plot.x(k)} x2={plot.x(k)} y1={F.y0} y2={F.y1} />
              <text x={plot.x(k)} y={F.y0 - 12} textAnchor="middle">
                {usd(k, k < 1 ? 3 : 0)}
              </text>
            </g>
          ))}
        </g>

        <path
          d={`${plot.line} L${F.x1},${plot.zeroY} L${F.x0},${plot.zeroY} Z`}
          fill={`url(#${uid}up)`}
          clipPath={`url(#${uid}above)`}
        />
        <path
          d={`${plot.line} L${F.x1},${plot.zeroY} L${F.x0},${plot.zeroY} Z`}
          fill={`url(#${uid}dn)`}
          clipPath={`url(#${uid}below)`}
        />

        <line
          className="od-chart-zero"
          x1={F.x0}
          x2={F.x1}
          y1={plot.zeroY}
          y2={plot.zeroY}
        />
        <path d={plot.line} className="od-chart-line" />

        {/* Break-even is the number a reader looks for first, so it is
            marked on the chart rather than only listed beside it. */}
        {plot.crossings.map((p) => (
          <g key={p} className="od-chart-be">
            <circle cx={plot.x(p)} cy={plot.zeroY} r="3.5" />
            <text x={plot.x(p)} y={plot.zeroY - 14} textAnchor="middle">
              {usd(p, plot.hi - plot.lo < 1 ? 3 : 2)}
            </text>
          </g>
        ))}

        <g className="od-chart-spot">
          <line x1={plot.x(spot)} x2={plot.x(spot)} y1={F.y0} y2={F.y1} />
        </g>

        <g className="od-chart-cursor">
          <line x1={cx} x2={cx} y1={F.y0} y2={F.y1} />
          <circle
            cx={cx}
            cy={cy}
            r="5.5"
            className={pnl >= 0 ? 'up' : 'down'}
          />
        </g>

        <g className="od-chart-ticks">
          {plot.ticks.map((t, i) => (
            <text
              key={t.label + i}
              x={t.x}
              y={F.axisY}
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

      <label className="od-chart-slider">
        <span>Reference move</span>
        <input
          aria-label="Reference price move"
          type="range"
          min="-60"
          max="60"
          step="0.5"
          value={move}
          onChange={(e) => setMove(Number(e.target.value))}
        />
        <b>
          {move > 0 ? '+' : ''}
          {move}%
        </b>
      </label>

      {stockQuantity > 0 && (
        <p className="od-note">
          Includes {stockQuantity} NVDA acquired at {usd(spot)}. Stock losses
          below the protected range remain yours.
        </p>
      )}
    </div>
  );
}
