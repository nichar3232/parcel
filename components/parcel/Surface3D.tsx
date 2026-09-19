'use client';
import { useMemo, useState } from 'react';
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
 * Drawn as an isometric mesh in plain SVG rather than WebGL. The mesh
 * is a few hundred quads, it renders identically on a phone, it prints,
 * it inherits the theme, and it costs the bundle nothing.
 */

const COLS = 26;
const ROWS = 14;

const W = 880,
  H = 462;

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
  const [yaw, setYaw] = useState(34);
  const [drag, setDrag] = useState<{ x: number; from: number } | null>(null);

  const mesh = useMemo(() => {
    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((l) => l.strike);
    const low = Math.min(...strikes),
      high = Math.max(...strikes);
    const lo = Math.min(spot * 0.75, low * 0.9);
    const hi = Math.max(spot * 1.25, high * 1.1);

    const from = date.includes('T') ? date : `${date}T00:00:00Z`;
    const expiry = terms.expiry;
    const to = expiry.slice(0, 10);
    const start = Date.parse(from);
    const end = Date.parse(`${to}T00:00:00Z`);
    const life = Math.max(1, end - start);

    // z is the position's value at (price, time) net of what it cost.
    // At the back edge that is today's mark; at the front it is expiry.
    const grid: number[][] = [];
    for (let j = 0; j < ROWS; j++) {
      const t = j / (ROWS - 1);
      const at = new Date(start + life * t).toISOString().slice(0, 19) + 'Z';
      const row: number[] = [];
      for (let i = 0; i < COLS; i++) {
        const price = lo + ((hi - lo) * i) / (COLS - 1);
        const value = orderGreeks(terms, price, at, vol).price;
        row.push(value - premium + stockQuantity * (price - spot));
      }
      grid.push(row);
    }

    const flat = grid.flat();
    const min = Math.min(...flat),
      max = Math.max(...flat);
    return { grid, lo, hi, min, max, span: max - min || 1 };
  }, [terms, premium, spot, date, vol, stockQuantity]);

  const project = useMemo(() => {
    const rad = (yaw * Math.PI) / 180;
    const ax = Math.cos(rad),
      az = Math.sin(rad);
    return (i: number, j: number, z: number) => {
      // Normalised cell coordinates, centred, then sheared into an
      // isometric box and lifted by the value.
      const u = i / (COLS - 1) - 0.5;
      const v = j / (ROWS - 1) - 0.5;
      const h = (z - mesh.min) / mesh.span;
      // Width, depth and lift are balanced so that the tallest front
      // corner still lands inside the frame at every yaw the drag
      // allows. Too much width and the mesh reads as a flat ribbon.
      return [
        W / 2 + (u * ax - v * az) * 560,
        H * 0.72 + (u * az + v * ax) * 180 - h * 185,
      ] as [number, number];
    };
  }, [yaw, mesh]);

  /**
   * Painter's algorithm.
   *
   * Quads are drawn back to front so the near face of a ridge covers
   * whatever is behind it. Sorting by depth rather than by index is
   * what lets the mesh be rotated at all.
   */
  const quads = useMemo(() => {
    const out: { d: string; fill: string; depth: number }[] = [];
    for (let j = 0; j < ROWS - 1; j++)
      for (let i = 0; i < COLS - 1; i++) {
        const corners: [number, number][] = [
          project(i, j, mesh.grid[j][i]),
          project(i + 1, j, mesh.grid[j][i + 1]),
          project(i + 1, j + 1, mesh.grid[j + 1][i + 1]),
          project(i, j + 1, mesh.grid[j + 1][i]),
        ];
        const mean =
          (mesh.grid[j][i] +
            mesh.grid[j][i + 1] +
            mesh.grid[j + 1][i + 1] +
            mesh.grid[j + 1][i]) /
          4;
        // Height drives opacity, sign drives hue: the reader sees the
        // profitable half of the surface without reading an axis.
        const lift = (mean - mesh.min) / mesh.span;
        const fill =
          mean >= 0
            ? `color-mix(in srgb, var(--pc-up) ${18 + lift * 62}%, transparent)`
            : `color-mix(in srgb, var(--pc-down) ${18 + (1 - lift) * 52}%, transparent)`;
        out.push({
          d: `M${corners.map((c) => c.join(',')).join('L')}Z`,
          fill,
          depth: corners.reduce((t, c) => t + c[1], 0),
        });
      }
    return out.sort((a, b) => a.depth - b.depth);
  }, [project, mesh]);

  /** The expiry edge, drawn on top so the familiar shape stays legible. */
  const edge = mesh.grid[ROWS - 1]
    .map((z, i) => {
      const [x, y] = project(i, ROWS - 1, z);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const today = mesh.grid[0]
    .map((z, i) => {
      const [x, y] = project(i, 0, z);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="od-surface">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Position value across price and time to expiry"
        onPointerDown={(e) => {
          setDrag({ x: e.clientX, from: yaw });
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const next = drag.from + (e.clientX - drag.x) * 0.22;
          setYaw(Math.max(12, Math.min(58, next)));
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        {quads.map((q, i) => (
          <path key={i} d={q.d} fill={q.fill} className="od-surface-cell" />
        ))}
        <path d={today} className="od-surface-edge today" />
        <path d={edge} className="od-surface-edge expiry" />
      </svg>

      <div className="od-surface-key">
        <span>
          <i className="today" />
          Today
        </span>
        <span>
          <i className="expiry" />
          At expiry
        </span>
        <span className="od-surface-range">
          {usd(mesh.lo, 0)} to {usd(mesh.hi, 0)}
        </span>
        <span className="od-surface-hint">Drag to rotate</span>
      </div>
    </div>
  );
}
