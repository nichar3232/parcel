import { PLOT, WALKTHROUGH } from '@/lib/oddlot/landing';
import type { StepFigure } from '@/lib/oddlot/landing';

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
  const p = figure.payoff;
  return (
    <>
      <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="lp-step-chart">
        <title>Payoff at expiry</title>
        <defs>
          <linearGradient id="lpStepFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--pc-cyan)" stopOpacity=".24" />
            <stop offset="1" stopColor="var(--pc-cyan)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lpStepStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--pc-cyan)" />
            <stop offset="1" stopColor="var(--pc-magenta)" />
          </linearGradient>
        </defs>

        <g className="lp-grid-band">
          {p.grid.map((g) => (
            <line key={g.y} x1={PLOT.x0} x2={PLOT.x1} y1={g.y} y2={g.y} />
          ))}
        </g>
        <g className="lp-strikes">
          {p.strikes.map((k, i) => (
            <g key={`${k.value}-${i}`}>
              <line x1={k.x} x2={k.x} y1={PLOT.y0} y2={PLOT.y1} />
              <text x={k.x} y={PLOT.y0 - 10} textAnchor="middle">
                ${k.value}
              </text>
            </g>
          ))}
        </g>

        <path d={p.area} fill="url(#lpStepFill)" />
        <line
          x1={PLOT.x0}
          x2={PLOT.x1}
          y1={p.zeroY}
          y2={p.zeroY}
          className="lp-zero"
        />
        <path d={p.line} className="lp-curve" stroke="url(#lpStepStroke)" />

        <g className="lp-ticks">
          {p.ticks.map((t, i) => (
            <text
              key={t.label}
              x={t.x}
              y={PLOT.axisY}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              data-mid={i === 1 || undefined}
            >
              {t.label}
            </text>
          ))}
        </g>
      </svg>
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
