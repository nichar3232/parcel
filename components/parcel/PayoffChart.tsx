'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { orderGreeks, strategyPnl } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * The payoff chart.
 *
 * A wide, horizontally scrollable strip — Robinhood-style — so capped
 * outcomes sit in view while unlimited legs keep going off the edge.
 * Drag or scrub the curve; scroll sideways to walk the price axis.
 * Horizontal cap rules mark max profit / max loss when they exist.
 */

const SAMPLES = 241;
const EPS = 1e-9;

/** Round gridline values — 1, 2, 2.5 or 5 times a power of ten — through zero. */
function niceTicks(min: number, max: number, target = 5) {
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toFixed(10)));
  return out;
}
const tickDp = (span: number) => (span < 0.5 ? 3 : span < 20 ? 2 : 0);
/** Top band holds strike / Now labels above the plot; bottom holds ticks. */
const PAD = { left: 58, right: 28, top: 44, bottom: 36 };
const LABEL_GAP = 54;

/** Nudge a sorted list of x-positions so neighbouring labels stay apart. */
function spaceLabels<T extends { x: number; width: number }>(
  items: T[],
  lo: number,
  hi: number,
): (T & { px: number })[] {
  const out = items.map((item) => ({ ...item, px: item.x }));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      const min = prev.px + (prev.width + cur.width) / 2;
      if (cur.px < min) {
        const mid = (prev.px + cur.px) / 2;
        prev.px = mid - (prev.width + cur.width) / 4;
        cur.px = mid + (prev.width + cur.width) / 4;
      }
    }
    for (const item of out) {
      item.px = Math.min(
        hi - item.width / 2,
        Math.max(lo + item.width / 2, item.px),
      );
    }
  }
  return out;
}

export function PayoffChart({
  terms,
  premium,
  spot,
  stockQuantity = 0,
  shock,
  onShock,
  date,
  vol,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
  stockQuantity?: number;
  /** Lifted when a parent wants the scrubber to survive a re-mount. */
  shock?: number;
  onShock?: (next: number) => void;
  /** With a date and a volatility, the chart also draws today's value. */
  date?: string;
  vol?: number;
}) {
  const uid = useId().replaceAll(':', '');
  const [ownShock, setOwnShock] = useState(0);
  const requestedMove = shock ?? ownShock;
  const setMove = onShock ?? setOwnShock;
  const [hover, setHover] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Nav picks remount this under the closing click — ignore that press.
  const armed = useRef(false);
  const centered = useRef(false);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    armed.current = false;
    centered.current = false;
    const ready = window.setTimeout(() => {
      armed.current = true;
    }, 400);
    return () => window.clearTimeout(ready);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !('ResizeObserver' in window)) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setView({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plot = useMemo(() => {
    const viewW = view?.w ?? 720;
    const h = view?.h ?? 300;
    const x0 = PAD.left,
      y0 = PAD.top,
      y1 = h - PAD.bottom;

    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((l) => l.strike);
    const lowStrike = Math.min(...strikes),
      highStrike = Math.max(...strikes);

    // Asymptotic slope at each wing — not the mid-domain tangent.
    // Listed equity settles at S ≥ 0, so the left wing is always finite
    // (Floor at S ≈ 0). Only the far-right wing can be truly unlimited.
    const pnlAt = (price: number) =>
      strategyPnl(terms, price, spot, premium, stockQuantity);
    const slopeBetween = (a: number, b: number) =>
      (pnlAt(b) - pnlAt(a)) / Math.max(EPS, b - a);
    // ~0.15 share of residual delta counts as an open wing.
    const OPEN = 0.15;
    const rightSlope = slopeBetween(spot * 8, spot * 16);
    const leftSlope = slopeBetween(
      Math.max(0.01, spot * 0.01),
      Math.max(0.02, spot * 0.05),
    );
    const rightOpenUp = rightSlope > OPEN;
    const rightOpenDown = rightSlope < -OPEN;
    // Left never gets an "Unlimited" badge — S = 0 caps it — but a
    // hard slope still means the reader should scroll toward the floor.
    const leftOpenUp = false;
    const leftOpenDown = false;
    const leftNeedsFloor = leftSlope < -OPEN || leftSlope > OPEN;

    const probeLo = Math.min(spot * 0.25, lowStrike * 0.7);
    const probeHi = Math.max(spot * 2.4, highStrike * 1.35);
    const probeAt = (i: number) =>
      probeLo + ((probeHi - probeLo) * i) / (SAMPLES - 1);
    const probe = Array.from({ length: SAMPLES }, (_, i) => pnlAt(probeAt(i)));
    const atFloor = pnlAt(0.01);
    const atFar = pnlAt(spot * 16);
    const samples = probe.concat(
      atFloor,
      rightOpenUp || rightOpenDown ? [] : [atFar],
      // Payoffs turn at strikes; even samples can step over the shelf.
      ...strikes.map((k) => pnlAt(k)),
    );

    const unlimitedProfit = rightOpenUp;
    const unlimitedLoss = rightOpenDown;
    const best = unlimitedProfit ? Infinity : Math.max(...samples);
    const worst = unlimitedLoss ? -Infinity : Math.min(...samples);

    // Scrollable domain: reach the $0 floor when the left wing still
    // slopes; stretch the right when payoff keeps running.
    let lo = Math.min(spot * 0.55, lowStrike * 0.85);
    let hi = Math.max(spot * 1.45, highStrike * 1.15);
    if (leftNeedsFloor || stockQuantity !== 0)
      lo = Math.min(lo, Math.max(0.01, spot * 0.05));
    if (rightOpenDown || rightOpenUp) hi = Math.max(hi, spot * 2.4);
    else hi = Math.max(hi, highStrike * 1.25, spot * 1.55);
    lo = Math.max(0.01, lo);

    // One viewport shows ~70% of spot; the canvas is wider when the domain is.
    const focusSpan = Math.max(spot * 0.7, highStrike - lowStrike, spot * 0.35);
    const domainSpan = hi - lo;
    const plotW = Math.max(
      viewW - PAD.left - PAD.right,
      ((viewW - PAD.left - PAD.right) * domainSpan) / focusSpan,
    );
    const canvasW = Math.round(plotW + PAD.left + PAD.right);
    const x1 = PAD.left + plotW;

    const priceAt = (i: number) => lo + ((hi - lo) * i) / (SAMPLES - 1);
    const rows = Array.from({ length: SAMPLES }, (_, i) => {
      const price = priceAt(i);
      return {
        price,
        pnl: strategyPnl(terms, price, spot, premium, stockQuantity),
      };
    });
    const now =
      date && vol && terms.reference === 'stock'
        ? Array.from({ length: 121 }, (_, i) => {
            const price = lo + ((hi - lo) * i) / 120;
            return {
              price,
              pnl:
                orderGreeks(terms, price, date, vol).price -
                premium +
                stockQuantity * (price - spot),
            };
          })
        : null;

    const finite = rows
      .map((r) => r.pnl)
      .concat((now ?? []).map((r) => r.pnl))
      .filter((v) => Number.isFinite(v));
    // Cap levels stay in the vertical scale even when a wing is unlimited,
    // so the flat "max profit" shelf remains readable while you scroll.
    const capHi = Number.isFinite(best) ? best : Math.max(0, ...finite);
    const capLo = Number.isFinite(worst) ? worst : Math.min(0, ...finite);
    let min = Math.min(0, capLo, ...finite);
    let max = Math.max(0, capHi, ...finite);
    // Leave headroom so an unlimited wing can keep climbing off-screen.
    if (unlimitedProfit) max = Math.max(max, capHi + Math.abs(capHi || 1) * 0.35);
    if (unlimitedLoss) min = Math.min(min, capLo - Math.abs(capLo || 1) * 0.35);
    const room = (max - min || Math.abs(premium) || 1) * 0.08;
    min -= room;
    max += room;
    const span = max - min || 1;

    const x = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    const y = (v: number) => y0 + ((max - v) / span) * (y1 - y0);
    const path = (list: { price: number; pnl: number }[]) =>
      list
        .map(
          (r, i) =>
            `${i ? 'L' : 'M'}${x(r.price).toFixed(1)},${y(r.pnl).toFixed(1)}`,
        )
        .join(' ');

    const crossings: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (a.pnl === 0 || a.pnl < 0 === b.pnl < 0) continue;
      crossings.push(
        a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl)),
      );
    }

    const line = path(rows);
    const tickCount = Math.max(5, Math.round(domainSpan / (focusSpan / 4)));
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const price = lo + (hi - lo) * (i / tickCount);
      return { x: x(price), label: usd(price, hi - lo < 1 ? 3 : 0), price };
    });

    return {
      canvasW,
      h,
      x0,
      x1,
      y0,
      y1,
      lo,
      hi,
      x,
      y,
      line,
      area: `${line} L${x1},${y(0)} L${x0},${y(0)} Z`,
      now: now ? path(now) : null,
      zeroY: y(0),
      crossings,
      best,
      worst,
      capY: Number.isFinite(best) ? y(best as number) : null,
      floorY: Number.isFinite(worst) ? y(worst as number) : null,
      unlimitedProfit,
      unlimitedLoss,
      leftOpenUp,
      leftOpenDown,
      rightOpenUp,
      rightOpenDown,
      strikes: [...new Set(strikes)].sort((a, b) => a - b),
      grid: niceTicks(min, max).map((v) => ({
        y: y(v),
        label: `${v < 0 ? '−' : ''}${usd(Math.abs(v), tickDp(max - min))}`,
      })),
      ticks,
    };
  }, [terms, premium, spot, stockQuantity, date, vol, view]);

  // Center the spot in the scroller once the canvas has a real width.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !view || centered.current) return;
    const spotX = plot.x(spot);
    const target = Math.max(0, spotX - view.w * 0.45);
    el.scrollLeft = target;
    centered.current = true;
  }, [plot, spot, view]);

  const minMove = Math.min(
    0,
    Math.max(-80, Math.ceil(((plot.lo / spot - 1) * 100) / 0.5) * 0.5),
  );
  const maxMove = Math.max(
    0,
    Math.min(120, Math.floor(((plot.hi / spot - 1) * 100) / 0.5) * 0.5),
  );
  const move = Math.min(maxMove, Math.max(minMove, requestedMove));
  const clampMove = (next: number) =>
    Math.round(Math.min(maxMove, Math.max(minMove, next)) * 10) / 10;

  const cents = plot.hi - plot.lo < 1 ? 4 : 2;
  const dp = terms.reference === 'dividend' ? 4 : 2;
  const reading = hover ?? spot * (1 + move / 100);
  const pnl = strategyPnl(terms, reading, spot, premium, stockQuantity);
  const cx = plot.x(reading),
    cy = plot.y(pnl);
  const away = (reading / spot - 1) * 100;

  const priceAt = (clientX: number) => {
    const root = canvas.current?.getBoundingClientRect();
    if (!root) return null;
    const px = Math.min(plot.x1, Math.max(plot.x0, clientX - root.left));
    return (
      plot.lo + ((px - plot.x0) / (plot.x1 - plot.x0)) * (plot.hi - plot.lo)
    );
  };
  const setScenarioAt = (clientX: number) => {
    const next = priceAt(clientX);
    if (next == null) return;
    setHover(next);
    setMove(clampMove((next / spot - 1) * 100));
  };
  const signed = (n: number) =>
    n === Infinity || n === -Infinity
      ? 'Unlimited'
      : `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${usd(Math.abs(n), dp)}`;
  const spotX = plot.x(spot);
  // Strike labels that would sit on top of each other collapse to every
  // other strike; "Now" always stays and is spaced away from neighbours.
  const strikeLabels = plot.strikes
    .filter((k, i, all) => i === 0 || plot.x(k) - plot.x(all[i - 1]!) >= 48)
    .map((k) => ({
      id: `k${k}`,
      x: plot.x(k),
      text: usd(k, k < 1 ? 3 : k % 1 ? 2 : 0),
      width: 46,
      kind: 'strike' as const,
    }));
  const topLabels = spaceLabels(
    [
      ...strikeLabels,
      {
        id: 'spot',
        x: spotX,
        text: `Now ${usd(spot, cents)}`,
        width: 86,
        kind: 'spot' as const,
      },
    ].sort((a, b) => a.x - b.x),
    plot.x0,
    plot.x1,
  ).filter((label, _, all) => {
    if (label.kind === 'spot') return true;
    const spotLabel = all.find((row) => row.kind === 'spot');
    return !spotLabel || Math.abs(label.px - spotLabel.px) >= 50;
  });
  // Skip an axis tick under a top label so $236 doesn't sit under "Now $225".
  const axisTicks = plot.ticks.filter((t) =>
    topLabels.every((l) => Math.abs(l.px - t.x) >= LABEL_GAP * 0.55),
  );
  // Cap / Floor sit inside the plot; keep them clear of the top label band
  // and of each other when both shelves are tight.
  const capTextY =
    plot.capY != null
      ? plot.capY < plot.y0 + 18
        ? plot.capY + 14
        : plot.capY - 8
      : null;
  const floorTextY =
    plot.floorY != null
      ? plot.floorY > plot.y1 - 18
        ? plot.floorY - 8
        : plot.floorY + 14
      : null;

  return (
    <div className="od-payoff">
      <div className="od-payoff-head">
        <div>
          <span>{stockQuantity ? 'Stock and options' : 'Profit and loss'}</span>
          <b>At expiry</b>
        </div>
        <div className="od-payoff-read">
          <b className={pnl >= 0 ? 'up' : 'down'}>{signed(pnl)}</b>
          <span>
            if {terms.symbol} is {usd(reading, cents)}
            {Math.abs(away) >= 0.05
              ? ` (${away > 0 ? '+' : ''}${away.toFixed(1)}%)`
              : ' (current price)'}
          </span>
        </div>
      </div>

      <div className="od-payoff-meta">
        <dl className="od-payoff-stats">
          <div>
            <dt>Break-even</dt>
            <dd>
              {plot.crossings.length
                ? plot.crossings.map((p) => usd(p, cents)).join(' / ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Max profit</dt>
            <dd className="up">{signed(plot.best)}</dd>
          </div>
          <div>
            <dt>Max loss</dt>
            <dd className="down">{signed(plot.worst)}</dd>
          </div>
        </dl>
        {plot.now && (
          <div className="od-payoff-legend">
            <span>
              <i className="expiry" />
              At expiry
            </span>
            <span>
              <i className="today" />
              Value today
            </span>
          </div>
        )}
      </div>

      <div
        ref={scroller}
        className="od-payoff-scroller"
        aria-label="Scroll the price axis to see capped and unlimited outcomes"
      >
        <div
          ref={canvas}
          className="od-payoff-canvas"
          style={{ width: plot.canvasW }}
          onPointerMove={(e) => {
            if (!armed.current) return;
            if (scrubbing) setScenarioAt(e.clientX);
            else setHover(priceAt(e.clientX));
          }}
          onPointerDown={(e) => {
            if (!armed.current) return;
            // Let two-finger / trackpad pans scroll; primary press scrubs.
            if (e.pointerType === 'touch' && !e.isPrimary) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(true);
            setScenarioAt(e.clientX);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            setScrubbing(false);
          }}
          onPointerCancel={() => setScrubbing(false)}
          onPointerLeave={() => setHover(null)}
        >
          {view && (
            <svg
              width={plot.canvasW}
              height={plot.h}
              aria-label="Option profit and loss across underlying prices"
              className="od-payoff-svg"
            >
              <defs>
                <linearGradient id={`${uid}up`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--pc-up)" stopOpacity=".32" />
                  <stop offset="1" stopColor="var(--pc-up)" stopOpacity=".03" />
                </linearGradient>
                <linearGradient id={`${uid}dn`} x1="0" x2="0" y1="1" y2="0">
                  <stop
                    offset="0"
                    stopColor="var(--pc-down)"
                    stopOpacity=".3"
                  />
                  <stop
                    offset="1"
                    stopColor="var(--pc-down)"
                    stopOpacity=".03"
                  />
                </linearGradient>
                <clipPath id={`${uid}above`}>
                  <rect
                    x={0}
                    y={0}
                    width={plot.canvasW}
                    height={Math.max(0, plot.zeroY)}
                  />
                </clipPath>
                <clipPath id={`${uid}below`}>
                  <rect
                    x={0}
                    y={plot.zeroY}
                    width={plot.canvasW}
                    height={Math.max(0, plot.h - plot.zeroY)}
                  />
                </clipPath>
              </defs>

              <g className="od-chart-grid">
                {plot.grid.map((g) => (
                  <g key={g.label + g.y}>
                    <line x1={plot.x0} x2={plot.x1} y1={g.y} y2={g.y} />
                    <text x={plot.x0 - 10} y={g.y + 4} textAnchor="end">
                      {g.label}
                    </text>
                  </g>
                ))}
              </g>

              {plot.capY != null && capTextY != null && (
                <g className="od-chart-cap up">
                  <line
                    x1={plot.x0}
                    x2={plot.x1}
                    y1={plot.capY}
                    y2={plot.capY}
                  />
                  <text
                    x={
                      plot.rightOpenDown || plot.rightOpenUp
                        ? plot.x0 + 8
                        : plot.x1 - 8
                    }
                    y={capTextY}
                    textAnchor={
                      plot.rightOpenDown || plot.rightOpenUp ? 'start' : 'end'
                    }
                  >
                    Cap {signed(plot.best)}
                  </text>
                </g>
              )}
              {plot.floorY != null && floorTextY != null && (
                <g className="od-chart-cap down">
                  <line
                    x1={plot.x0}
                    x2={plot.x1}
                    y1={plot.floorY}
                    y2={plot.floorY}
                  />
                  <text
                    x={
                      plot.leftOpenDown || plot.leftOpenUp
                        ? plot.x1 - 8
                        : plot.x0 + 8
                    }
                    y={floorTextY}
                    textAnchor={
                      plot.leftOpenDown || plot.leftOpenUp ? 'end' : 'start'
                    }
                  >
                    Floor {signed(plot.worst)}
                  </text>
                </g>
              )}

              <g className="od-chart-strikes">
                {plot.strikes.map((k) => (
                  <line
                    key={k}
                    x1={plot.x(k)}
                    x2={plot.x(k)}
                    y1={plot.y0}
                    y2={plot.y1}
                  />
                ))}
              </g>

              <g className="od-chart-toplabels">
                {topLabels.map((l) => (
                  <text
                    key={l.id}
                    className={l.kind === 'spot' ? 'spot' : 'strike'}
                    x={l.px}
                    y={plot.y0 - 16}
                    textAnchor="middle"
                  >
                    {l.text}
                  </text>
                ))}
              </g>

              <path
                d={plot.area}
                fill={`url(#${uid}up)`}
                clipPath={`url(#${uid}above)`}
                className="od-chart-area"
              />
              <path
                d={plot.area}
                fill={`url(#${uid}dn)`}
                clipPath={`url(#${uid}below)`}
                className="od-chart-area"
              />
              <line
                className="od-chart-zero"
                x1={plot.x0}
                x2={plot.x1}
                y1={plot.zeroY}
                y2={plot.zeroY}
              />
              {plot.now && <path d={plot.now} className="od-chart-now" />}
              <path
                d={plot.line}
                className="od-chart-line up"
                clipPath={`url(#${uid}above)`}
              />
              <path
                d={plot.line}
                className="od-chart-line down"
                clipPath={`url(#${uid}below)`}
              />

              {plot.crossings.map((p) => (
                <circle
                  key={p}
                  className="od-chart-be"
                  cx={plot.x(p)}
                  cy={plot.zeroY}
                  r="3.5"
                />
              ))}

              <g className="od-chart-spot">
                <line x1={spotX} x2={spotX} y1={plot.y0} y2={plot.y1} />
              </g>

              <g className="od-chart-cursor">
                <line x1={cx} x2={cx} y1={plot.y0} y2={plot.y1} />
                <circle
                  cx={cx}
                  cy={cy}
                  r="5"
                  className={pnl >= 0 ? 'up' : 'down'}
                />
              </g>

              {plot.rightOpenUp && (
                <text
                  className="od-chart-open up"
                  x={plot.x1 - 6}
                  y={Math.max(plot.y0 + 18, (capTextY ?? plot.y0) + 16)}
                  textAnchor="end"
                >
                  Unlimited →
                </text>
              )}
              {plot.rightOpenDown && (
                <text
                  className="od-chart-open down"
                  x={plot.x1 - 6}
                  y={Math.min(plot.y1 - 10, (floorTextY ?? plot.y1) - 16)}
                  textAnchor="end"
                >
                  Unlimited →
                </text>
              )}
              {plot.leftOpenUp && (
                <text
                  className="od-chart-open up"
                  x={plot.x0 + 6}
                  y={Math.max(plot.y0 + 18, (capTextY ?? plot.y0) + 16)}
                  textAnchor="start"
                >
                  ← Unlimited
                </text>
              )}
              {plot.leftOpenDown && (
                <text
                  className="od-chart-open down"
                  x={plot.x0 + 6}
                  y={Math.min(plot.y1 - 10, (floorTextY ?? plot.y1) - 16)}
                  textAnchor="start"
                >
                  ← Unlimited
                </text>
              )}

              <g className="od-chart-ticks">
                {axisTicks.map((t, i) => (
                  <text
                    key={t.label + i}
                    x={t.x}
                    y={plot.h - 10}
                    textAnchor={
                      i === 0
                        ? 'start'
                        : i === axisTicks.length - 1
                          ? 'end'
                          : 'middle'
                    }
                  >
                    {t.label}
                  </text>
                ))}
              </g>
            </svg>
          )}
        </div>
      </div>

      <label className="od-chart-slider">
        <span>Price move</span>
        <input
          aria-label="Reference price move"
          type="range"
          min={minMove}
          max={maxMove}
          step="0.5"
          value={move}
          onInput={(e) => setMove(clampMove(Number(e.currentTarget.value)))}
          onChange={(e) => setMove(clampMove(Number(e.target.value)))}
        />
        <b>
          {move > 0 ? '+' : ''}
          {move}%
        </b>
      </label>

      {stockQuantity > 0 && (
        <p className="od-note">
          Includes {stockQuantity} {terms.symbol} acquired at {usd(spot)}.
        </p>
      )}
    </div>
  );
}
