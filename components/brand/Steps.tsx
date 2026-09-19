'use client';

import { useEffect, useRef } from 'react';
import { WALKTHROUGH } from '@/lib/parcel/landing';
import type { StepFigure } from '@/lib/parcel/landing';
import { PayoffGlyph } from './PayoffGlyph';

/**
 * A payoff drawn small, for a step figure.
 *
 * The same projection the hero uses, with the P&L gridline labels
 * dropped: at this size they crowd the curve, and the step is showing
 * that the shape exists, not asking anyone to read a value off it.
 */
function StepPayoff({
  figure,
}: {
  figure: Extract<StepFigure, { kind: 'payoff' }>;
}) {
  return (
    <>
      <PayoffGlyph
        payoff={figure.payoff}
        className="lp-step-chart"
        density="compact"
      />
      <p className="lp-step-note">{figure.contract}</p>
    </>
  );
}

function Figure({ figure }: { figure: StepFigure }) {
  if (figure.kind === 'payoff') return <StepPayoff figure={figure} />;

  if (figure.kind === 'balance')
    return (
      <div className="lp-step-balance">
        <b>{figure.total}</b>
        <dl>
          {figure.rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
              <i style={{ width: `${Math.round(r.share * 100)}%` }} />
            </div>
          ))}
        </dl>
      </div>
    );

  if (figure.kind === 'sizes')
    return (
      <div className="lp-step-sizes">
        <div>
          {figure.sizes.map((s) => (
            <span key={s.label} className={s.selected ? 'on' : undefined}>
              <em>{s.label}</em>
              <b>{s.cost}</b>
            </span>
          ))}
        </div>
        <p className="lp-step-note">{figure.note}</p>
      </div>
    );

  return (
    <dl className="lp-step-review">
      {figure.rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * How it works.
 *
 * The introduction leads a four-step sequence in normal document flow. The
 * former sticky treatment made the section feel like it was fighting the
 * reader's scroll; each step now arrives once as it enters the reading area.
 */
export function Steps({ children }: { children: React.ReactNode }) {
  const stepsRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (
      !stepsRef.current ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;

    const steps = [...stepsRef.current.querySelectorAll('li')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const step = entry.target as HTMLElement;
          step.classList.add('is-revealed');
          observer.unobserve(step);
        }
      },
      { rootMargin: '0px 0px -10%', threshold: 0.16 },
    );

    for (const step of steps) {
      step.classList.add('is-awaiting');
      observer.observe(step);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lp-how-grid">
      <div className="lp-how-copy">{children}</div>

      <ol ref={stepsRef} className="lp-how-steps">
        {WALKTHROUGH.map((step, i) => (
          <li key={step.id}>
            <figure className="lp-step-figure">
              <Figure figure={step.figure} />
            </figure>
            <div className="lp-step-copy">
              <b>{i + 1}</b>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
