'use client';

import { useState } from 'react';
import { HERO } from '@/lib/parcel/landing';

/**
 * An interactive, engine-priced indication rather than a decorative mockup.
 * It deliberately stops before execution: the desk remains the only place
 * that creates an owner-bound quote or moves a balance.
 */
export function PositionPreview() {
  const [size, setSize] = useState(HERO.sizes.at(-1)!);
  const stats = [
    { k: 'Size', v: size.label },
    { k: 'Max loss', v: size.premium },
    { k: 'Break-even', v: HERO.breakEven },
    { k: 'Expiry', v: HERO.expiryLabel },
  ];

  return (
    <figure className="lp-card" aria-labelledby="position-preview-title">
      <figcaption className="lp-card-head">
        <span className="lp-card-kicker">Model indication</span>
        <span className="lp-card-state">
          <i aria-hidden /> Historical close
        </span>
      </figcaption>

      <div className="lp-card-title-row">
        <div>
          <span className="lp-card-symbol">NVDA</span>
          <h2 id="position-preview-title">{HERO.title}</h2>
          <p>
            {HERO.contract} — expires {HERO.expiryLabel}
          </p>
        </div>
        <div className="lp-card-reference">
          <span>Reference close</span>
          <strong>{HERO.spotLabel}</strong>
          <small>{HERO.openLabel}</small>
        </div>
      </div>

      <fieldset className="lp-size-control">
        <legend>Share-equivalent</legend>
        <div>
          {HERO.sizes.map((candidate) => (
            <button
              type="button"
              key={candidate.quantity}
              aria-pressed={candidate.quantity === size.quantity}
              className={candidate.quantity === size.quantity ? 'selected' : ''}
              onClick={() => setSize(candidate)}
            >
              {candidate.quantity.toFixed(2)}×
            </button>
          ))}
        </div>
      </fieldset>

      <div className="lp-chart">
        <svg viewBox="0 0 760 240" aria-label="Payoff at expiry">
          <title>{`Payoff at expiry for a ${size.label} ${HERO.title}`}</title>
          <defs>
            <linearGradient id="lpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity=".34" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[44, 86, 128, 170].map((y) => (
            <line key={y} x1="40" x2="720" y1={y} y2={y} className="lp-chart-grid" />
          ))}
          {HERO.strikeX.map((x, i) => (
            <line
              key={HERO.strikes[i]}
              x1={x}
              x2={x}
              y1="24"
              y2="208"
              className="lp-strike"
            />
          ))}
          <path d={HERO.area} fill="url(#lpFill)" />
          <line
            x1="40"
            x2="720"
            y1={HERO.zeroY}
            y2={HERO.zeroY}
            className="lp-grid"
          />
          <path d={HERO.line} className="lp-line" />
          {HERO.strikeX.map((x, i) => (
            <text
              key={HERO.strikes[i]}
              x={x}
              y="222"
              className="lp-strike-label"
              textAnchor="middle"
            >
              ${HERO.strikes[i]}
            </text>
          ))}
        </svg>
        <div className="lp-axis">
          {HERO.axis.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="lp-ticket-detail" aria-live="polite">
        <span>
          Model premium <strong>{size.premium}</strong>
        </span>
        <span>
          Cash to fund exercise <strong>{size.exerciseCash}</strong>
        </span>
      </div>

      <div className="lp-stats">
        {stats.map((stat) => (
          <div key={stat.k}>
            <span>{stat.k}</span>
            <strong>{stat.v}</strong>
          </div>
        ))}
      </div>
    </figure>
  );
}
