'use client';
import { useState } from 'react';
import { STRUCTURES } from '@/lib/parcel/landing';
import { PayoffGlyph } from './PayoffGlyph';

/**
 * The front page's payoff viewer.
 *
 * Six structures, one precise shape at a time. A payoff chart is a
 * financial explanation, not ambient animation: the reader chooses a
 * structure and its line, strikes, scale and statistics update together.
 */
export function StructureHero() {
  const [index, setIndex] = useState(0);
  const current = STRUCTURES[index];

  return (
    <div className="lp-viewer">
      <header>
        <div>
          <h2>{current.name}</h2>
          <p className="lp-viewer-contract">{current.contract}</p>
        </div>
      </header>

      <div className="lp-viewer-plot">
        <PayoffGlyph
          key={current.id}
          payoff={current.payoff}
          fadeKey={current.id}
          title={`${current.name} payoff at expiry. ${current.blurb}`}
        />
      </div>

      <p className="lp-viewer-blurb">{current.blurb}</p>

      <dl className="lp-viewer-stats">
        {current.stats.map((s) => (
          <div key={s.k}>
            <dt>{s.k}</dt>
            <dd className={s.multiline ? 'multiline' : undefined}>{s.v}</dd>
          </div>
        ))}
      </dl>

      <nav className="lp-viewer-pips" aria-label="Payoff structures">
        {STRUCTURES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.name}
            aria-current={i === index ? 'true' : undefined}
            className={i === index ? 'on' : ''}
            onClick={() => setIndex(i)}
            title={s.name}
          >
            {s.name}
          </button>
        ))}
      </nav>
    </div>
  );
}
