'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { orderGreeks } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * The payoff surface.
 *
 * A payoff chart shows the shape at expiry, which is the one day of a
 * contract's life a holder spends the least time in. The surface adds
 * the axis that is actually being traded: what the position is worth
 * today, next week, and the morning it expires. Theta stops being a
 * number in a table and becomes the slope you can see the whole thing
 * sliding down.
 *
 * An orthographic camera in plain SVG: yaw turns the whole way round,
 * pitch tips it from side-on to overhead, and the floor carries the three
 * axes with their values so a reading off any corner means something. A
 * few hundred quads render identically on a phone, print, and inherit
 * the theme.
 */

const COLS = 28;
const ROWS = 16;
const W = 880,
  H = 480;
/** World box: price across, time deep, value up. */
const BOX = { x: 1.6, y: 1, z: 0.62 };

const DEFAULT_VIEW = { yaw: 36, pitch: 28 };

export function Surface3D({
  terms,
  premium,
  spot,
  date,
  vol,
  stockQuantity = 0,
}: {
  terms: OrderTerms;
  premium: number;
  spot: number;
  date: string;
  vol: number;
  stockQuantity?: number;
}) {
  const [view, setView] = useState(DEFAULT_VIEW);
  const drag = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    last: number;
    at: number;
    speed: number;
  } | null>(null);
  const spin = useRef<number | null>(null);

  const mesh = useMemo(() => {
    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((l) => l.strike);
    const low = Math.min(...strikes),
      high = Math.max(...strikes);
    const lo = Math.min(spot * 0.75, low * 0.9);
    const hi = Math.max(spot * 1.25, high * 1.1);

    const from = date.includes('T') ? date : `${date}T00:00:00Z`;
    const start = Date.parse(from);
    const end = Date.parse(`${terms.expiry.slice(0, 10)}T20:00:00Z`);
    const life = Math.max(3_600_000, end - start);

    // z is the position's value at (price, time) net of what it cost.
    // Row 0 is today's mark; the last row is expiry.
    const grid: number[][] = [];
    for (let j = 0; j < ROWS; j++) {
      const at = new Date(start + (life * j) / (ROWS - 1)).toISOString();
      const row: number[] = [];
      for (let i = 0; i < COLS; i++) {
        const price = lo + ((hi - lo) * i) / (COLS - 1);
        const value = orderGreeks(terms, price, at, vol).price;
        row.push(value - premium + stockQuantity * (price - spot));
      }
      grid.push(row);
    }
    const flat = grid.flat();
    const min = Math.min(...flat, 0),
      max = Math.max(...flat, 0);
    return { grid, lo, hi, min, max, span: max - min || 1, start, end };
  }, [terms, premium, spot, date, vol, stockQuantity]);

  /** World point → screen, with a depth for painting back to front. */
  const camera = useMemo(() => {
    const yaw = (view.yaw * Math.PI) / 180,
      pitch = (view.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    // The bounding sphere fixes the scale, so the mesh never breathes
    // in and out as it turns and never leaves the frame.
    const radius = Math.hypot(BOX.x, BOX.y, BOX.z) / 2;
    // Wider than tall: the mesh's horizontal reach is the full radius,
    // its height at any pitch is well under it.
    const scale = Math.min(W / 2 / radius, (H / 2 / radius) * 1.3) * 0.94;
    return (x: number, y: number, z: number) => {
      const rx = x * cy - y * sy;
      const ry = x * sy + y * cy;
      return {
        sx: W / 2 + rx * scale,
        sy: H / 2 - (z * cp + ry * sp) * scale,
        depth: ry * cp - z * sp,
      };
    };
  }, [view]);

  const world = useMemo(
    () => (i: number, j: number, value: number) =>
      [
        (i / (COLS - 1) - 0.5) * BOX.x,
        (j / (ROWS - 1) - 0.5) * BOX.y,
        ((value - mesh.min) / mesh.span - 0.5) * BOX.z,
      ] as const,
    [mesh],
  );

  const quads = useMemo(() => {
    const out: { d: string; fill: string; depth: number }[] = [];
    const at = (i: number, j: number) => {
      const [x, y, z] = world(i, j, mesh.grid[j][i]);
      return camera(x, y, z);
    };
    for (let j = 0; j < ROWS - 1; j++)
      for (let i = 0; i < COLS - 1; i++) {
        const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const mean =
          (mesh.grid[j][i] +
            mesh.grid[j][i + 1] +
            mesh.grid[j + 1][i + 1] +
            mesh.grid[j + 1][i]) /
          4;
        const lift = (mean - mesh.min) / mesh.span;
        const fill =
          mean >= 0
            ? `color-mix(in srgb, var(--pc-up) ${30 + lift * 55}%, var(--pc-void))`
            : `color-mix(in srgb, var(--pc-down) ${30 + (1 - lift) * 50}%, var(--pc-void))`;
        out.push({
          d: `M${c.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join('L')}Z`,
          fill,
          depth: c.reduce((t, p) => t + p.depth, 0) / 4,
        });
      }
    // Far first, so the near face of a ridge covers what is behind it.
    return out.sort((a, b) => b.depth - a.depth);
  }, [camera, mesh, world]);

  const line = (points: { sx: number; sy: number }[]) =>
    points
      .map((p, k) => `${k ? 'L' : 'M'}${p.sx.toFixed(1)},${p.sy.toFixed(1)}`)
      .join(' ');
  const rowPath = (j: number) =>
    line(
      mesh.grid[j].map((v, i) => {
        const [x, y, z] = world(i, j, v);
        return camera(x, y, z);
      }),
    );

  /* The floor, the zero plane and the three labelled axes. */
  const floorZ = -BOX.z / 2;
  const zeroZ = ((0 - mesh.min) / mesh.span - 0.5) * BOX.z;
  const hx = BOX.x / 2,
    hy = BOX.y / 2;
  const corner = (x: number, y: number, z = floorZ) => camera(x, y, z);
  const floor = [
    corner(-hx, -hy),
    corner(hx, -hy),
    corner(hx, hy),
    corner(-hx, hy),
  ];
  const zero = [
    corner(-hx, -hy, zeroZ),
    corner(hx, -hy, zeroZ),
    corner(hx, hy, zeroZ),
    corner(-hx, hy, zeroZ),
  ];
  // Axes run along whichever floor edges face the camera, so their
  // labels are never drawn behind the surface.
  const nearY =
    camera(0, hy, floorZ).depth < camera(0, -hy, floorZ).depth ? hy : -hy;
  const nearX =
    camera(hx, 0, floorZ).depth < camera(-hx, 0, floorZ).depth ? hx : -hx;
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    label: usd(mesh.lo + (mesh.hi - mesh.lo) * f, 0),
    at: corner((f - 0.5) * BOX.x, nearY + Math.sign(nearY) * 0.09),
    grid: [corner((f - 0.5) * BOX.x, -hy), corner((f - 0.5) * BOX.x, hy)],
  }));
  const dayLabel = (t: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      t,
    );
  const timeTicks = [0, 0.5, 1].map((f) => ({
    label:
      f === 0
        ? 'Today'
        : f === 1
          ? 'Expiry'
          : dayLabel(mesh.start + (mesh.end - mesh.start) * f),
    at: corner(nearX + Math.sign(nearX) * 0.17, (f - 0.5) * BOX.y),
    grid: [corner(-hx, (f - 0.5) * BOX.y), corner(hx, (f - 0.5) * BOX.y)],
  }));
  // The value axis stands at the far end of the price axis, clear of
  // the corner where the price and time labels already meet.
  const postX = -nearX;
  const post = [
    corner(postX, nearY, -BOX.z / 2),
    corner(postX, nearY, BOX.z / 2),
  ];
  const valueTicks = [mesh.min, 0, mesh.max]
    .filter((v, k, all) => all.indexOf(v) === k)
    .map((v) => ({
      label: `${v > 0 ? '+' : v < 0 ? '−' : ''}${usd(Math.abs(v))}`,
      at: corner(
        postX + Math.sign(postX) * 0.16,
        nearY - Math.sign(nearY) * 0.04,
        ((v - mesh.min) / mesh.span - 0.5) * BOX.z,
      ),
    }));
  const title = (x: number, y: number, z: number) => camera(x, y, z);
  const priceTitle = title(0, nearY + Math.sign(nearY) * 0.22, floorZ);
  const timeTitle = title(nearX + Math.sign(nearX) * 0.36, 0, floorZ);

  /* Rotation: drag, arrow keys, or let go with some speed to coast. */
  const stopSpin = () => {
    if (spin.current) cancelAnimationFrame(spin.current);
    spin.current = null;
  };
  useEffect(() => stopSpin, []);
  const coast = (speed: number) => {
    stopSpin();
    let v = speed;
    const step = () => {
      v *= 0.94;
      if (Math.abs(v) < 0.02) return;
      setView((s) => ({ ...s, yaw: (s.yaw + v + 360) % 360 }));
      spin.current = requestAnimationFrame(step);
    };
    spin.current = requestAnimationFrame(step);
  };

  return (
    <div className="od-surface">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          stopSpin();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            yaw: view.yaw,
            pitch: view.pitch,
            last: e.clientX,
            at: performance.now(),
            speed: 0,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const now = performance.now();
          d.speed = ((e.clientX - d.last) * 0.4 * 16) / Math.max(1, now - d.at);
          d.last = e.clientX;
          d.at = now;
          setView({
            yaw: (d.yaw + (e.clientX - d.x) * 0.4 + 3600) % 360,
            pitch: Math.max(4, Math.min(84, d.pitch + (e.clientY - d.y) * 0.3)),
          });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && performance.now() - d.at < 80 && Math.abs(d.speed) > 0.3)
            coast(d.speed);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <path d={`${line(floor)}Z`} className="od-surface-floor" />
        {priceTicks.map((t) => (
          <path
            key={`pg${t.label}`}
            d={line(t.grid)}
            className="od-surface-grid"
          />
        ))}
        {timeTicks.map((t) => (
          <path
            key={`tg${t.label}`}
            d={line(t.grid)}
            className="od-surface-grid"
          />
        ))}
        <path d={line(post)} className="od-surface-axis" />

        {quads.map((q, i) => (
          <path key={i} d={q.d} fill={q.fill} className="od-surface-cell" />
        ))}
        <path d={`${line(zero)}Z`} className="od-surface-zero" />
        <path d={rowPath(0)} className="od-surface-edge today" />
        <path d={rowPath(ROWS - 1)} className="od-surface-edge expiry" />

        <g className="od-surface-labels">
          {priceTicks.map((t) => (
            <text key={t.label} x={t.at.sx} y={t.at.sy} textAnchor="middle">
              {t.label}
            </text>
          ))}
          {timeTicks.map((t) => (
            <text key={t.label} x={t.at.sx} y={t.at.sy} textAnchor="middle">
              {t.label}
            </text>
          ))}
          {valueTicks.map((t) => (
            <text
              key={t.label}
              x={t.at.sx}
              y={t.at.sy + 4}
              textAnchor={t.at.sx > W / 2 ? 'start' : 'end'}
              className="value"
            >
              {t.label}
            </text>
          ))}
          <text
            x={priceTitle.sx}
            y={priceTitle.sy}
            textAnchor="middle"
            className="title"
          >
            {terms.symbol} price
          </text>
          <text
            x={timeTitle.sx}
            y={timeTitle.sy}
            textAnchor="middle"
            className="title"
          >
            Time
          </text>
          <text
            x={post[1].sx}
            y={post[1].sy - 12}
            textAnchor="middle"
            className="title"
          >
            P&amp;L
          </text>
        </g>
      </svg>

      <div className="od-surface-key">
        <span>
          <i className="today" />
          Value today
        </span>
        <span>
          <i className="expiry" />
          At expiry
        </span>
        <span>
          <i className="zero" />
          Break-even
        </span>
        <label className="od-surface-turn">
          <span>Turn</span>
          <input
            type="range"
            min={0}
            max={359}
            value={Math.round(view.yaw)}
            aria-label="Rotate the surface"
            onChange={(e) => {
              stopSpin();
              setView((v) => ({ ...v, yaw: Number(e.target.value) }));
            }}
          />
        </label>
        <button
          type="button"
          className="od-surface-reset"
          onClick={() => {
            stopSpin();
            setView(DEFAULT_VIEW);
          }}
        >
          <RotateCcw size={12} />
          Reset view
        </button>
      </div>
    </div>
  );
}
