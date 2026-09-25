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
        <Held index={index}>
          {(t) => (
            <div>
              <h2>{t.name}</h2>
              <p className="lp-viewer-contract">{t.contract}</p>
            </div>
          )}
        </Held>
      </header>

      <div className="lp-viewer-plot">
        <PayoffGlyph
          key={current.id}
          payoff={current.payoff}
          fadeKey={current.id}
          title={`${current.name} payoff at expiry.`}
        />
      </div>

      <dl className="lp-viewer-stats">
        {current.stats.map((_, k) => (
          <div key={k}>
            <Held index={index} as="dt">
              {(t) => <span>{t.stats[k].k}</span>}
            </Held>
            <Held index={index} as="dd">
              {(t) => (
                <span className={t.stats[k].multiline ? 'multiline' : undefined}>
                  {t.stats[k].v}
                </span>
              )}
            </Held>
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

/**
 * Text that changes with the structure but must not move the page.
 *
 * Every structure's version sits in the same grid cell and only the
 * current one is visible, so the cell is always as tall as the longest
 * version at the current width. Switching structures then changes what
 * is written, never where anything else on the page sits.
 */
function Held({
  index,
  as: Tag = 'div',
  className,
  children,
}: {
  index: number;
  as?: 'div' | 'dt' | 'dd';
  className?: string;
  children: (t: (typeof STRUCTURES)[number]) => React.ReactNode;
}) {
  return (
    <Tag className={`lp-held ${className ?? ''}`}>
      {STRUCTURES.map((t, i) => (
        <div key={t.id} className={i === index ? 'on' : ''} aria-hidden={i !== index}>
          {children(t)}
        </div>
      ))}
    </Tag>
  );
}
