'use client';
import { useId } from 'react';
import { PLOT } from '@/lib/parcel/landing';
import type { Payoff } from '@/lib/parcel/landing';

/**
 * The landing page's payoff drawing, shared by the hero, the product
 * showcase and the walkthrough so they are one chart and not three.
 *
 * The line is green where the position makes money and red where it
 * loses, and the fill under it is the same, split at the zero rule.
 * A quiet P&L scale keeps the shape grounded in real values. What is
 * marked most strongly is what a reader looks for first — the strikes,
 * the reference price and the break-even.
 *
 * Compact figures keep the reference lines but drop the scale labels;
 * they are a visual preview, not a place to read a quoted value.
 */
export function PayoffGlyph({
  payoff,
  line = payoff.line,
  zeroY = payoff.zeroY,
  className,
  title = 'Payoff at expiry',
  fadeKey,
  density = 'full',
}: {
  payoff: Payoff;
  line?: string;
  zeroY?: number;
  className?: string;
  title?: string;
  /** Changes when the shape does, so the labels replay their rise. */
  fadeKey?: string;
  density?: 'full' | 'compact';
}) {
  const uid = useId();
  const up = `${uid}up`,
    dn = `${uid}dn`,
    above = `${uid}above`,
    below = `${uid}below`;
  const area = `${line} L${PLOT.x1},${zeroY.toFixed(1)} L${PLOT.x0},${zeroY.toFixed(1)} Z`;
  const spot = payoff.ticks[1];
  const dp = payoff.best - payoff.worst < 1 ? 3 : 2;
  const zeroLabel =
    payoff.grid.find((g) => Math.abs(g.y - payoff.zeroY) < 1)?.label ?? '$0';

  return (
    <svg
      viewBox={`0 0 ${PLOT.w} ${PLOT.h}`}
      className={className}
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={up} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pc-up)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--pc-up)" stopOpacity=".02" />
        </linearGradient>
        <linearGradient id={dn} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--pc-down)" stopOpacity=".28" />
          <stop offset="1" stopColor="var(--pc-down)" stopOpacity=".02" />
        </linearGradient>
        {/* One area path, clipped to each side of the zero rule. The
            clips take a little slack past the plot so a line drawn on
            the edge is not shaved. */}
        <clipPath id={above}>
          <rect
            x={PLOT.x0 - 4}
            y={PLOT.y0 - 6}
            width={PLOT.x1 - PLOT.x0 + 8}
            height={Math.max(0, zeroY - PLOT.y0 + 6)}
          />
        </clipPath>
        <clipPath id={below}>
          <rect
            x={PLOT.x0 - 4}
            y={zeroY}
            width={PLOT.x1 - PLOT.x0 + 8}
            height={Math.max(0, PLOT.y1 - zeroY + 6)}
          />
        </clipPath>
      </defs>

      {density === 'full' && (
        <text className="lp-axis-title" x={PLOT.x0} y={PLOT.y0 - 15}>
          P&amp;L / share
        </text>
      )}

      <g key={`k${fadeKey ?? ''}`} className="lp-strikes">
        {payoff.strikes.map((k, i) => (
          <g key={`${k.value}-${i}`}>
            <line x1={k.x} x2={k.x} y1={PLOT.y0} y2={PLOT.y1} />
            <text x={k.x} y={PLOT.y0 - 12} textAnchor="middle">
              ${k.value}
            </text>
          </g>
        ))}
      </g>

      <g className="lp-spot">
        <line x1={spot.x} x2={spot.x} y1={PLOT.y0} y2={PLOT.y1} />
      </g>

      <path d={area} fill={`url(#${up})`} clipPath={`url(#${above})`} />
      <path d={area} fill={`url(#${dn})`} clipPath={`url(#${below})`} />

      <g className="lp-pnl-grid">
        {payoff.grid
          .filter((g) => Math.abs(g.y - zeroY) > 1)
          .map((g) => (
            <g key={`${g.y}-${g.label}`}>
              <line x1={PLOT.x0} x2={PLOT.x1} y1={g.y} y2={g.y} />
              {density === 'full' && (
                <text x={PLOT.x0 - 12} y={g.y + 4} textAnchor="end">
                  {g.label}
                </text>
              )}
            </g>
          ))}
      </g>

      <line
        className="lp-zero"
        x1={PLOT.x0}
        x2={PLOT.x1}
        y1={zeroY}
        y2={zeroY}
      />
      {density === 'full' && (
        <text
          className="lp-zero-label"
          x={PLOT.x0 - 12}
          y={zeroY + 4}
          textAnchor="end"
        >
          {zeroLabel}
        </text>
      )}

      <path d={line} className="lp-curve up" clipPath={`url(#${above})`} />
      <path d={line} className="lp-curve down" clipPath={`url(#${below})`} />

      {/* The label sits above zero on the side where the line is below
          it, which is the one corner of the crossing that is empty. */}
      <g key={`b${fadeKey ?? ''}`} className="lp-be">
        {payoff.crossings.map((c) => {
          const next = payoff.points.find(([px]) => px > c.x);
          const rising = !next || next[1] < payoff.zeroY;
          return (
            <g key={c.x}>
              <circle cx={c.x} cy={zeroY} r="4.5" />
              <text
                x={rising ? c.x - 12 : c.x + 12}
                y={zeroY - 12}
                textAnchor={rising ? 'end' : 'start'}
              >
                ${c.value.toFixed(dp)}
              </text>
            </g>
          );
        })}
      </g>

      <g className="lp-ticks">
        {payoff.ticks.map((t, i) => (
          <text
            key={t.label}
            x={t.x}
            y={PLOT.axisY}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            data-mid={i === 1 || undefined}
          >
            {i === 1 ? `Reference ${t.label}` : t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}
