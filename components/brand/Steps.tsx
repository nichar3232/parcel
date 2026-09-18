import { WALKTHROUGH } from '@/lib/oddlot/landing';
import type { StepFigure } from '@/lib/oddlot/landing';
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
      <PayoffGlyph payoff={figure.payoff} className="lp-step-chart" />
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
 * The left column states the claim once and stays put; the right
 * column walks through it. Sticky rather than fixed, so the copy
 * releases at the end of the section instead of following the reader
 * into the footer, and so the whole thing degrades to two stacked
 * columns on a narrow screen without a media query having to undo
 * anything.
 */
export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-how-grid">
      <div className="lp-how-copy">{children}</div>

      <ol className="lp-how-steps">
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
