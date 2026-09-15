'use client';
import { useId, useState } from 'react';
import { cashPayoff } from '@/lib/oddlot/math';
import type { OrderTerms } from '@/lib/oddlot/types';
import { usd } from './shared';
export function PayoffChart({
  terms,
  premium,
  spot,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
}) {
  const [shock, setShock] = useState(0),
    id = useId().replaceAll(':', '');
  const strikes = terms.legs.map((l) => l.strike);
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
    pnl: cashPayoff(terms, price) - premium,
  }));
  const min = Math.min(-0.01, ...rows.map((r) => r.pnl)),
    max = Math.max(0.01, ...rows.map((r) => r.pnl)),
    spread = max - min;
  const x = (v: number) => 48 + ((v - start) / (end - start)) * 592,
    y = (v: number) => 24 + ((max - v) / spread) * 192;
  const line = rows
      .map((r, i) => `${i ? 'L' : 'M'}${x(r.price)},${y(r.pnl)}`)
      .join(' '),
    zero = y(0);
  const selected = spot * (1 + shock / 100),
    pnl = cashPayoff(terms, selected) - premium;
  return (
    <div className="od-payoff">
      <div className="od-chart-caption">
        <span>Payoff at expiry</span>
        <b className={pnl >= 0 ? 'od-positive' : 'od-negative'}>
          {pnl >= 0 ? '+' : ''}
          {usd(pnl, terms.reference === 'dividend' ? 4 : 2)}
        </b>
      </div>
      <svg
        viewBox="0 0 680 254"
        aria-label="Option profit and loss across underlying prices"
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#4169e1" stopOpacity=".17" />
            <stop offset="1" stopColor="#4169e1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1="48"
              x2="640"
              y1={24 + n * 192}
              y2={24 + n * 192}
              stroke="#e8ebf1"
              strokeDasharray="3 5"
            />
            <text
              x="40"
              y={28 + n * 192}
              textAnchor="end"
              fill="#8891a2"
              fontSize="10"
            >
              {usd(max - spread * n, terms.reference === 'dividend' ? 3 : 0)}
            </text>
          </g>
        ))}
        <path d={`${line} L640,${zero} L48,${zero}Z`} fill={`url(#${id})`} />
        <line x1="48" x2="640" y1={zero} y2={zero} stroke="#b2bbcc" />
        <path
          d={line}
          fill="none"
          stroke="#4268dd"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1="24"
          y2="216"
          stroke="#9aa9ca"
          strokeDasharray="3 3"
        />
        <circle
          cx={x(selected)}
          cy={y(pnl)}
          r="5"
          fill="#4268dd"
          stroke="white"
          strokeWidth="2"
        />
        {[start, spot, end].map((v) => (
          <text
            key={v}
            x={x(v)}
            y="244"
            textAnchor="middle"
            fill="#8891a2"
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
