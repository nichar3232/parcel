'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLOT, STRUCTURES } from '@/lib/oddlot/landing';

const DWELL = 5200;
const MORPH = 720;

/** Cubic in-out. Linear morphing between two payoff shapes reads as a
 *  slide; easing it makes the line look like it is settling. */
const ease = (k: number) =>
  k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

const path = (points: [number, number][]) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y.toFixed(1)}`).join(' ');

/**
 * The front page's payoff viewer.
 *
 * Six structures, one shape at a time, morphing between them. They
 * share a price grid, so every shape has a y for the same 81 x values
 * and two of them interpolate point for point — the line bends from a
 * long call into a collar instead of cross-fading, which is the whole
 * reason the shapes are worth showing on a landing page at all.
 *
 * The cycle stops while a pointer is over the card and while the tab
 * is hidden: a visitor reading the figures should not have them
 * replaced under them, and an unwatched tab should not be animating.
 */
export function StructureHero() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const current = STRUCTURES[index];

  const [points, setPoints] = useState(current.payoff.points);
  const [zeroY, setZeroY] = useState(current.payoff.zeroY);
  // What is on screen right now, so an interrupted morph resumes from
  // where the line actually is rather than from where it started. Kept
  // in an effect: reading or writing a ref during render is exactly the
  // thing that makes a component miss an update.
  const live = useRef({ points, zeroY });
  useEffect(() => {
    live.current = { points, zeroY };
  });

  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  // Morph to whichever structure is selected.
  useEffect(() => {
    const target = STRUCTURES[index].payoff;
    const from = live.current;
    if (reduced.current) {
      setPoints(target.points);
      setZeroY(target.zeroY);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / MORPH),
        e = ease(k);
      setPoints(
        from.points.map(([x, y], i) => [
          x,
          y + (target.points[i][1] - y) * e,
        ]) as [number, number][],
      );
      setZeroY(from.zeroY + (target.zeroY - from.zeroY) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [index]);

  // Advance on a timer unless the reader is holding it.
  useEffect(() => {
    if (held) return;
    const id = setTimeout(
      () => setIndex((i) => (i + 1) % STRUCTURES.length),
      DWELL,
    );
    return () => clearTimeout(id);
  }, [index, held]);

  useEffect(() => {
    const onVisibility = () => setHeld(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const line = useMemo(() => path(points), [points]);
  const area = `${line} L${PLOT.x1},${zeroY.toFixed(1)} L${PLOT.x0},${zeroY.toFixed(1)} Z`;

  return (
    <div
      className="lp-viewer"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <header>
        <div>
          <span className="lp-tag">{current.tag}</span>
          <h2>{current.name}</h2>
          <p className="lp-viewer-contract">{current.contract}</p>
        </div>
        <Link className="lp-viewer-open" href={`/app?at=${current.at}`}>
          Open
          <span aria-hidden>&rarr;</span>
        </Link>
      </header>

      <div className="lp-viewer-plot">
        <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`}>
          <title>{`${current.name} payoff at expiry. ${current.blurb}`}</title>
          <defs>
            <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--pc-cyan)" stopOpacity=".26" />
              <stop offset="1" stopColor="var(--pc-cyan)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lpStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--pc-cyan)" />
              <stop offset="1" stopColor="var(--pc-magenta)" />
            </linearGradient>
          </defs>

          {/* The P&L scale is per-shape, so it cross-fades with the
              shape while the line itself morphs. */}
          <g key={`g${current.id}`} className="lp-grid-band">
            {current.payoff.grid.map((g) => (
              <g key={g.label + g.y}>
                <line x1={PLOT.x0} x2={PLOT.x1} y1={g.y} y2={g.y} />
                <text x={PLOT.x0 - 12} y={g.y + 3.5} textAnchor="end">
                  {g.label}
                </text>
              </g>
            ))}
          </g>

          <g key={`k${current.id}`} className="lp-strikes">
            {current.payoff.strikes.map((k, i) => (
              <g key={`${k.value}-${i}`}>
                <line x1={k.x} x2={k.x} y1={PLOT.y0} y2={PLOT.y1} />
                <text x={k.x} y={PLOT.y0 - 10} textAnchor="middle">
                  ${k.value}
                </text>
              </g>
            ))}
          </g>

          <path d={area} fill="url(#lpArea)" />
          <line
            className="lp-zero"
            x1={PLOT.x0}
            x2={PLOT.x1}
            y1={zeroY}
            y2={zeroY}
          />
          <path
            d={line}
            className="lp-curve"
            fill="none"
            stroke="url(#lpStroke)"
          />

          <g className="lp-ticks">
            {current.payoff.ticks.map((t, i) => (
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
      </div>

      <p className="lp-viewer-blurb">{current.blurb}</p>

      <dl className="lp-viewer-stats">
        {current.stats.map((s) => (
          <div key={s.k}>
            <dt>{s.k}</dt>
            <dd>{s.v}</dd>
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
          >
            <i
              style={
                i === index && !held
                  ? { animationDuration: `${DWELL}ms` }
                  : undefined
              }
            />
          </button>
        ))}
      </nav>
    </div>
  );
}
