'use client';
import { useId } from 'react';
import { PLOT } from '@/lib/oddlot/landing';
import type { Payoff } from '@/lib/oddlot/landing';

/**
 * The landing page's payoff drawing, shared by the hero, the product
 * showcase and the walkthrough so they are one chart and not three.
 *
 * The line is green where the position makes money and red where it
 * loses, and the fill under it is the same, split at the zero rule.
 * There is no P&L grid: the stats beside the chart quote the numbers,
 * and the shape is what the chart is for. What is marked is what a
 * reader looks for first — the strikes, the reference price and the
 * break-even.
 *
 * The hero morphs one shape into the next, so it passes the line it
 * is drawing this frame and where zero is; everything else defaults
 * to the structure's own payoff.
 */
export function PayoffGlyph({
  payoff,
  line = payoff.line,
  zeroY = payoff.zeroY,
  className,
  title = 'Payoff at expiry',
  fadeKey,
}: {
  payoff: Payoff;
  line?: string;
  zeroY?: number;
  className?: string;
  title?: string;
  /** Changes when the shape does, so the labels replay their rise. */
  fadeKey?: string;
}) {
  const uid = useId();
  const up = `${uid}up`,
    dn = `${uid}dn`,
    above = `${uid}above`,
    below = `${uid}below`;
  const area = `${line} L${PLOT.x1},${zeroY.toFixed(1)} L${PLOT.x0},${zeroY.toFixed(1)} Z`;
  const spot = payoff.ticks[1];
  const dp = payoff.best - payoff.worst < 1 ? 3 : 2;

  return (
    <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className={className}>
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

      <line
        className="lp-zero"
        x1={PLOT.x0}
        x2={PLOT.x1}
        y1={zeroY}
        y2={zeroY}
      />

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
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}
