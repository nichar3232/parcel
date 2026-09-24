'use client';
import { useMemo, useState } from 'react';
import { orderGreeks } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * A bounded value surface for advanced option analysis.
 *
 * The old free-rotating mesh was mathematically sound but was difficult to
 * read once a label or edge rotated toward the camera. This uses a fixed,
 * deliberately shallow projection: price always runs left to right, time
 * always recedes away from the reader, and higher P&L always rises. The
 * alternate grid view uses the exact same samples when a flatter reading is
 * more useful than perspective.
 */

const COLS = 31;
const ROWS = 11;
const W = 920;
const H = 420;
const FRAME = { left: 68, right: 52, top: 34, bottom: 68 };
const DEPTH = { x: 72, y: 88 };
const ELEVATION = 186;

type Point = { x: number; y: number };
type SurfaceMode = 'perspective' | 'grid';

const path = (points: Point[], close = false) =>
  `${points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}${close ? 'Z' : ''}`;

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
  const [mode, setMode] = useState<SurfaceMode>('perspective');

  const mesh = useMemo(() => {
    const strikes = terms.curve
      ? [terms.curve.lower, terms.curve.upper]
      : terms.legs.map((leg) => leg.strike);
    const low = Math.min(...strikes);
    const high = Math.max(...strikes);
    const lo = Math.min(spot * 0.75, low * 0.9);
    const hi = Math.max(spot * 1.25, high * 1.1);
    const start = Date.parse(date.includes('T') ? date : `${date}T00:00:00Z`);
    const expiry = Date.parse(`${terms.expiry.slice(0, 10)}T20:00:00Z`);
    const life = Math.max(3_600_000, expiry - start);

    const values = Array.from({ length: ROWS }, (_, row) => {
      const at = new Date(start + (life * row) / (ROWS - 1)).toISOString();
      return Array.from({ length: COLS }, (_, column) => {
        const price = lo + ((hi - lo) * column) / (COLS - 1);
        return (
          orderGreeks(terms, price, at, vol).price -
          premium +
          stockQuantity * (price - spot)
        );
      });
    });
    const all = values.flat();
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    return {
      values,
      lo,
      hi,
      min,
      max,
      span: max - min || 1,
      start,
      expiry,
    };
  }, [terms, premium, spot, date, vol, stockQuantity]);

  const project = (column: number, row: number, value: number): Point => {
    const xFraction = column / (COLS - 1);
    const timeFraction = row / (ROWS - 1);
    const height = (value - mesh.min) / mesh.span;
    return {
      x:
        FRAME.left +
        xFraction * (W - FRAME.left - FRAME.right - DEPTH.x) +
        timeFraction * DEPTH.x,
      y: H - FRAME.bottom - timeFraction * DEPTH.y - height * ELEVATION,
    };
  };

  const surface = (() => {
    const cells: {
      perspective: string;
      grid: { x: number; y: number };
      fill: string;
    }[] = [];
    const gridWidth = W - FRAME.left - FRAME.right;
    const gridHeight = H - FRAME.top - FRAME.bottom;
    for (let row = 0; row < ROWS - 1; row++) {
      for (let column = 0; column < COLS - 1; column++) {
        const cornerValues = [
          mesh.values[row][column],
          mesh.values[row][column + 1],
          mesh.values[row + 1][column + 1],
          mesh.values[row + 1][column],
        ];
        const mean = cornerValues.reduce((sum, value) => sum + value, 0) / 4;
        const lift = (mean - mesh.min) / mesh.span;
        const fill =
          mean >= 0
            ? `color-mix(in srgb, var(--pc-up) ${32 + lift * 50}%, var(--pc-void))`
            : `color-mix(in srgb, var(--pc-down) ${34 + (1 - lift) * 46}%, var(--pc-void))`;
        cells.push({
          perspective: path(
            [
              project(column, row, cornerValues[0]),
              project(column + 1, row, cornerValues[1]),
              project(column + 1, row + 1, cornerValues[2]),
              project(column, row + 1, cornerValues[3]),
            ],
            true,
          ),
          grid: {
            x: FRAME.left + (column * gridWidth) / (COLS - 1),
            y: FRAME.top + (row * gridHeight) / (ROWS - 1),
          },
          fill,
        });
      }
    }
    return {
      cells,
      gridWidth,
      gridHeight,
      cellWidth: gridWidth / (COLS - 1),
      cellHeight: gridHeight / (ROWS - 1),
    };
  })();

  const rowPath = (row: number) =>
    path(mesh.values[row].map((value, column) => project(column, row, value)));
  const zeroPlane = path(
    [
      project(0, 0, 0),
      project(COLS - 1, 0, 0),
      project(COLS - 1, ROWS - 1, 0),
      project(0, ROWS - 1, 0),
    ],
    true,
  );
  const basePlane = path(
    [
      project(0, 0, mesh.min),
      project(COLS - 1, 0, mesh.min),
      project(COLS - 1, ROWS - 1, mesh.min),
      project(0, ROWS - 1, mesh.min),
    ],
    true,
  );
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const price = mesh.lo + (mesh.hi - mesh.lo) * fraction;
    return {
      label: usd(price, mesh.hi - mesh.lo < 1 ? 3 : 0),
      perspectiveX: project((COLS - 1) * fraction, 0, mesh.min).x,
      gridX: FRAME.left + fraction * (W - FRAME.left - FRAME.right),
    };
  });
  const formatDay = (timestamp: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      timestamp,
    );
  const signed = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd(Math.abs(value))}`;

  return (
    <div className="od-surface">
      <div className="od-surface-toolbar">
        <span>Read by price and time</span>
        <fieldset className="od-surface-view" aria-label="Surface view">
          <button
            type="button"
            className={mode === 'perspective' ? 'selected' : ''}
            aria-pressed={mode === 'perspective'}
            onClick={() => setMode('perspective')}
          >
            Perspective
          </button>
          <button
            type="button"
            className={mode === 'grid' ? 'selected' : ''}
            aria-pressed={mode === 'grid'}
            onClick={() => setMode('grid')}
          >
            Grid
          </button>
        </fieldset>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`od-surface-svg ${mode}`}
        aria-label={`Modelled ${terms.symbol} profit and loss across price and time`}
      >
        <title>Modelled profit and loss across price and time</title>
        {mode === 'perspective' ? (
          <>
            <path d={basePlane} className="od-surface-floor" />
            {surface.cells.map((cell, index) => (
              <path
                key={index}
                d={cell.perspective}
                fill={cell.fill}
                className="od-surface-cell"
              />
            ))}
            <path d={zeroPlane} className="od-surface-zero" />
            <path d={rowPath(0)} className="od-surface-edge today" />
            <path d={rowPath(ROWS - 1)} className="od-surface-edge expiry" />
          </>
        ) : (
          <>
            <rect
              x={FRAME.left}
              y={FRAME.top}
              width={surface.gridWidth}
              height={surface.gridHeight}
              className="od-surface-grid-frame"
            />
            {surface.cells.map((cell, index) => (
              <rect
                key={index}
                x={cell.grid.x}
                y={cell.grid.y}
                width={surface.cellWidth}
                height={surface.cellHeight}
                fill={cell.fill}
                className="od-surface-cell"
              />
            ))}
            <line
              x1={FRAME.left}
              x2={FRAME.left + surface.gridWidth}
              y1={FRAME.top + surface.cellHeight / 2}
              y2={FRAME.top + surface.cellHeight / 2}
              className="od-surface-edge today"
            />
            <line
              x1={FRAME.left}
              x2={FRAME.left + surface.gridWidth}
              y1={FRAME.top + surface.gridHeight - surface.cellHeight / 2}
              y2={FRAME.top + surface.gridHeight - surface.cellHeight / 2}
              className="od-surface-edge expiry"
            />
          </>
        )}

        <g className="od-surface-labels">
          {priceTicks.map((tick) => (
            <text
              key={tick.label}
              x={mode === 'grid' ? tick.gridX : tick.perspectiveX}
              y={H - 21}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          <text x={W - 18} y={24} textAnchor="end" className="title">
            P&amp;L
          </text>
          <text x={W / 2} y={H - 5} textAnchor="middle" className="title">
            {terms.symbol} price
          </text>
          <text
            x={18}
            y={mode === 'grid' ? FRAME.top + 5 : H - FRAME.bottom + 4}
            className="title"
          >
            Today
          </text>
          <text
            x={mode === 'grid' ? 18 : FRAME.left + DEPTH.x - 10}
            y={
              mode === 'grid'
                ? FRAME.top + surface.gridHeight + 5
                : H - FRAME.bottom - DEPTH.y + 4
            }
            className="title"
          >
            Expiry
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
        {mode === 'perspective' && (
          <span>
            <i className="zero" />
            Break-even plane
          </span>
        )}
        <span className="od-surface-range">
          {formatDay(mesh.start)} → {formatDay(mesh.expiry)} ·{' '}
          {signed(mesh.min)} to {signed(mesh.max)}
        </span>
      </div>
    </div>
  );
}
