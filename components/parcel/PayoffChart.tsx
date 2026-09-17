'use client';
import { useId, useState } from 'react';
import { strategyPnl } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';
export function PayoffChart({
  terms,
  premium,
  spot,
  stockQuantity = 0,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
  stockQuantity?: number;
}) {
  const [shock, setShock] = useState(0),
    id = useId().replaceAll(':', '');
  const strikes = terms.curve
    ? [terms.curve.lower, terms.curve.upper]
    : terms.legs.map((l) => l.strike);
  const start = Math.min(spot * 0.65, Math.min(...strikes) * 0.85),
    end = Math.max(spot * 1.35, Math.max(...strikes) * 1.15);
  const prices = [
    ...new Set([
      ...Array.from({ length: 81 }, (_, i) => start + ((end - start) * i) / 80),
      ...strikes,
    ]),
  ].sort((a, b) => a - b);
  const rows = prices.map((price) => ({
    price,
    pnl: strategyPnl(terms, price, spot, premium, stockQuantity),
  }));
  // Plot geometry. The chart shares a row with the order ticket, so it is
  // drawn tall enough to fill that height instead of floating in it.
  const TOP = 24,
    PLOT = 430,
    BASE = TOP + PLOT,
    HEIGHT = BASE + 38;
  const min = Math.min(-0.01, ...rows.map((r) => r.pnl)),
    max = Math.max(0.01, ...rows.map((r) => r.pnl)),
    spread = max - min;
  const x = (v: number) => 48 + ((v - start) / (end - start)) * 592,
    y = (v: number) => TOP + ((max - v) / spread) * PLOT;
  const line = rows
      .map((r, i) => `${i ? 'L' : 'M'}${x(r.price)},${y(r.pnl)}`)
      .join(' '),
    zero = y(0);
  const selected = spot * (1 + shock / 100),
    pnl = strategyPnl(terms, selected, spot, premium, stockQuantity);
  return (
    <div className="od-payoff">
      {stockQuantity > 0 && (
        <p className="od-form-note">
          Includes {stockQuantity} NVDA acquired at {usd(spot)}. Stock losses
          below the protected range remain yours.
        </p>
      )}
      <div className="od-chart-caption">
        <span>
          {stockQuantity
            ? 'Stock + options P&L at expiry'
            : 'Options-only P&L at expiry'}
        </span>
        <b className={pnl >= 0 ? 'od-positive' : 'od-negative'}>
          {pnl >= 0 ? '+' : ''}
          {usd(pnl, terms.reference === 'dividend' ? 4 : 2)}
        </b>
      </div>
      <svg
        viewBox={`0 0 680 ${HEIGHT}`}
        aria-label="Option profit and loss across underlying prices"
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3fc98e" stopOpacity=".17" />
            <stop offset="1" stopColor="#3fc98e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1="48"
              x2="640"
              y1={TOP + n * PLOT}
              y2={TOP + n * PLOT}
              stroke="#eef3f4"
              strokeDasharray="3 5"
            />
            <text
              x="40"
              y={TOP + 4 + n * PLOT}
              textAnchor="end"
              fill="#78868e"
              fontSize="10"
            >
              {usd(
                max - spread * n,
                terms.reference === 'dividend' || spread < 0.1
                  ? 3
                  : spread < 10
                    ? 2
                    : 0,
              )}
            </text>
          </g>
        ))}
        <path d={`${line} L640,${zero} L48,${zero}Z`} fill={`url(#${id})`} />
        <line x1="48" x2="640" y1={zero} y2={zero} stroke="#cdd7da" />
        <path
          d={line}
          fill="none"
          stroke="#3fc98e"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={TOP}
          y2={BASE}
          stroke="#a9b4b8"
          strokeDasharray="3 3"
        />
        <circle
          cx={x(selected)}
          cy={y(pnl)}
          r="5"
          fill="#3fc98e"
          stroke="white"
          strokeWidth="2"
        />
        {[start, spot, end].map((v) => (
          <text
            key={v}
            x={x(v)}
            y={HEIGHT - 10}
            textAnchor="middle"
            fill="#78868e"
            fontSize="11"
          >
            {usd(v, terms.reference === 'dividend' ? 3 : 0)}
          </text>
        ))}
      </svg>
      <label className="od-chart-slider">
        <span>Reference move</span>
        <input
          aria-label="Reference price move"
          type="range"
          min="-30"
          max="30"
          step="1"
          value={shock}
          onChange={(e) => setShock(Number(e.target.value))}
        />
        <b>
          {shock > 0 ? '+' : ''}
          {shock}%
        </b>
      </label>
    </div>
  );
}
