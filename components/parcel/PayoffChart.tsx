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
const PAD = { left: 52, right: 24, top: 40, bottom: 32 };
/** Minimum pixel gap between top labels and between axis ticks. */
const LABEL_GAP = 64;

type TopLabel = {
  id: string;
  x: number;
  text: string;
  width: number;
  kind: 'strike' | 'spot';
  /** Vertical offset above the plot top (higher = further up). */
  lift: number;
};

/**
 * Keep top labels on their marker x. When two collide, drop the lower-
 * priority one (strike loses to spot; later strike loses to earlier)
 * instead of nudging text off its line. Moderately close pairs stagger
 * vertically so both can stay.
 */
function placeTopLabels(items: Omit<TopLabel, 'lift'>[]): TopLabel[] {
  const ranked = [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'spot' ? -1 : 1;
    return a.x - b.x;
  });
  const kept: TopLabel[] = [];
  for (const item of ranked) {
    const hit = kept.find(
      (k) => Math.abs(k.x - item.x) < (k.width + item.width) / 2 + 8,
    );
    if (!hit) {
      kept.push({ ...item, lift: 14 });
      continue;
    }
    // Spot always wins a hard collision; strikes yield to spot or peer.
    if (item.kind === 'strike') continue;
    if (hit.kind === 'strike') {
      kept.splice(kept.indexOf(hit), 1);
      kept.push({ ...item, lift: 14 });
    }
  }
  // Soft collision: stagger a surviving strike above Now when close.
  kept.sort((a, b) => a.x - b.x);
  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1]!;
    const cur = kept[i]!;
    const gap = Math.abs(cur.x - prev.x);
    const need = (prev.width + cur.width) / 2;
    if (gap < need + 12 && gap >= need * 0.45) {
      if (prev.kind === 'strike') prev.lift = 28;
      else if (cur.kind === 'strike') cur.lift = 28;
    }
  }
  return kept;
}

/** Prefer strike / breakeven; fill gaps with sparse nice prices.
 *  `avoidX` keeps filler ticks clear of top markers (Now). Landmarks
 *  still compete later against top-label widths. `focus` densifies the
 *  one-viewport window so a wide scrollable domain isn't only $200/$400. */
function axisTickPrices(
  keys: number[],
  lo: number,
  hi: number,
  x: (v: number) => number,
  maxTicks = 6,
  avoidX: number[] = [],
  focus?: { lo: number; hi: number },
): number[] {
  const span = hi - lo || 1;
  const inDomain = (p: number) =>
    p >= lo - span * 0.001 && p <= hi + span * 0.001;
  const clearOfAvoid = (p: number) =>
    avoidX.every((ax) => Math.abs(x(p) - ax) >= LABEL_GAP * 0.7);
  const seen = new Set<number>();
  const ranked: { p: number; rank: number; soft?: boolean }[] = [];
  for (const [i, p] of keys.entries()) {
    if (!inDomain(p) || seen.has(p)) continue;
    seen.add(p);
    // Soft avoid: landmarks may sit near Now; the top-label pass drops
    // the ones that truly collide with the "Now …" text.
    ranked.push({ p, rank: i, soft: true });
  }
  if (focus) {
    for (const [i, p] of niceTicks(focus.lo, focus.hi, 5).entries()) {
      if (!inDomain(p) || seen.has(p)) continue;
      seen.add(p);
      ranked.push({ p, rank: 40 + i });
    }
  }
  for (const [i, p] of niceTicks(lo, hi, 5).entries()) {
    if (!inDomain(p) || seen.has(p)) continue;
    seen.add(p);
    ranked.push({ p, rank: 100 + i });
  }

  const picked: number[] = [];
  for (const { p, soft } of ranked.sort((a, b) => a.rank - b.rank)) {
    // Keep axis sparse — don't crowd Now with filler prices, and don't
    // stack ticks on top of each other across the scrollable canvas.
    if (!soft && !clearOfAvoid(p)) continue;
    if (picked.some((q) => Math.abs(x(q) - x(p)) < LABEL_GAP * 0.85)) continue;
    picked.push(p);
    if (picked.length >= maxTicks) break;
  }
  return picked.sort((a, b) => a - b);
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

    // Y-scale from one viewport of price around spot — not the full
    // scrollable domain. Unlimited wings otherwise push max/min to the
    // far edge and crush the near-spot shape into the floor.
    const focusHalf = focusSpan / 2;
    const yPriceLo = Math.max(lo, spot - focusHalf);
    const yPriceHi = Math.min(hi, spot + focusHalf);
    const inYWindow = (price: number) =>
      price >= yPriceLo - EPS && price <= yPriceHi + EPS;
    const focusPnls = rows
      .filter((r) => inYWindow(r.price))
      .map((r) => r.pnl)
      .concat(
        (now ?? []).filter((r) => inYWindow(r.price)).map((r) => r.pnl),
      )
      .filter((v) => Number.isFinite(v));
    // Finite Cap / Floor shelves stay in scale so the dashed rules remain
    // readable; open wings only get modest edge headroom.
    const landmarks: number[] = [0, pnlAt(spot)];
    if (Number.isFinite(best)) landmarks.push(best as number);
    if (Number.isFinite(worst)) landmarks.push(worst as number);
    for (const k of new Set(strikes)) landmarks.push(pnlAt(k));

    const focusPool =
      focusPnls.length > 0 ? focusPnls : [pnlAt(spot), 0];
    let min = Math.min(...focusPool, ...landmarks);
    let max = Math.max(...focusPool, ...landmarks);
    const baseSpan = max - min || Math.abs(premium) || 1;
    // Let an open wing climb off the viewport edge without owning the
    // whole vertical range — slope stays readable near spot.
    if (unlimitedProfit)
      max += Math.max(Math.abs(premium) || 1, baseSpan * 0.22);
    if (unlimitedLoss)
      min -= Math.max(Math.abs(premium) || 1, baseSpan * 0.22);
    const room = (max - min || Math.abs(premium) || 1) * 0.1;
    min -= room;
    max += room;
    // Keep zero inside the plot with a little air so a one-sided
    // payoff (long call near ATM) doesn't glue to the floor/ceiling.
    if (min > -room * 0.5) min = Math.min(min, -room * 0.5);
    if (max < room * 0.5) max = Math.max(max, room * 0.5);
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
    const uniqueStrikes = [...new Set(strikes)].sort((a, b) => a - b);
    // Axis prefers landmarks the reader already cares about.
    // Strike first (structure), then breakeven if it still has room.
    // Spot stays off the axis — it already has the "Now" top label.
    const tickPrices = axisTickPrices(
      [...uniqueStrikes, ...crossings],
      lo,
      hi,
      x,
      Math.max(5, Math.round(domainSpan / (focusSpan / 3.5))),
      [x(spot)],
      { lo: yPriceLo, hi: yPriceHi },
    );
    const priceDp = hi - lo < 1 ? 3 : hi - lo < 20 ? 2 : 0;
    const ticks = tickPrices.map((price) => ({
      x: x(price),
      label: usd(price, priceDp),
      price,
    }));

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
      strikes: uniqueStrikes,
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
  const todayPnl =
    plot.now && date && vol && terms.reference === 'stock'
      ? orderGreeks(terms, reading, date, vol).price -
        premium +
        stockQuantity * (reading - spot)
      : null;
  const cx = plot.x(reading),
    cy = plot.y(pnl);
  const todayCy = todayPnl != null ? plot.y(todayPnl) : null;
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
  // When strike sits on top of spot, drop the strike label (keep the line).
  // Moderately close pairs stagger vertically instead of sliding sideways.
  const topLabels = placeTopLabels(
    [
      ...plot.strikes.map((k) => ({
        id: `k${k}`,
        x: plot.x(k),
        text: usd(k, k < 1 ? 3 : k % 1 ? 2 : 0),
        width: Math.max(36, usd(k, k < 1 ? 3 : k % 1 ? 2 : 0).length * 7.2),
        kind: 'strike' as const,
      })),
      {
        id: 'spot',
        x: spotX,
        text: `Now ${usd(spot, cents)}`,
        width: Math.max(72, (`Now ${usd(spot, cents)}`).length * 7),
        kind: 'spot' as const,
      },
    ].sort((a, b) => a.x - b.x),
  );
  // Drop axis ticks that crowd a top label (Now / strike). Top and
  // bottom share the same x, so a $228 tick under "Now $224.52" reads
  // as a collision even when the prices differ.
  const axisTicks = plot.ticks.filter(
    (t) =>
      !topLabels.some((l) => {
        const half = Math.max(l.width / 2, 28);
        return Math.abs(l.x - t.x) < half + 10;
      }),
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
          <div className="od-payoff-legend" aria-hidden="true">
            <span>
              <i className="expiry" />
              Expiry
            </span>
            <span>
              <i className="today" />
              Today
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
                    x={l.x}
                    y={plot.y0 - l.lift}
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
                {todayCy != null && (
                  <circle cx={cx} cy={todayCy} r="4" className="today" />
                )}
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
