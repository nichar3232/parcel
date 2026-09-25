'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { RotateCcw } from 'lucide-react';
import { orderGreeks } from '@/lib/parcel/math';
import type { OrderTerms } from '@/lib/parcel/types';
import { usd } from './shared';

/**
 * Value across price and time.
 *
 * Perspective is a live orthographic camera in SVG: drag to orbit, wheel
 * (or pinch) to zoom, and labels sit on the near floor edges so they stay
 * readable as the mesh turns. Overlapping labels are culled rather than
 * stacked. Grid is the same samples flattened for a quieter reading.
 */

const COLS = 28;
const ROWS = 16;
const W = 920;
const H = 460;
/** World box: price across, time deep, value up. */
const BOX = { x: 1.6, y: 1, z: 0.62 };
const DEFAULT_VIEW = { yaw: 36, pitch: 28, zoom: 1 };
const FRAME = { left: 68, right: 52, top: 34, bottom: 68 };
const LABEL_PAD = 10;
const CHAR_W = 7.2;

type SurfaceMode = 'perspective' | 'grid';
type Screen = { sx: number; sy: number; depth: number };
type PlacedLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  className?: string;
  priority: number;
  width: number;
};

const estimateWidth = (text: string) =>
  Math.max(28, text.replace(/&amp;/g, '&').length * CHAR_W);

/** Keep higher-priority labels; drop later ones that collide. */
function placeLabels(candidates: PlacedLabel[]): PlacedLabel[] {
  const ranked = [...candidates].sort((a, b) => a.priority - b.priority);
  const kept: PlacedLabel[] = [];
  for (const item of ranked) {
    const left =
      item.anchor === 'middle'
        ? item.x - item.width / 2
        : item.anchor === 'end'
          ? item.x - item.width
          : item.x;
    const right = left + item.width;
    const top = item.y - 10;
    const bottom = item.y + 6;
    const hit = kept.some((other) => {
      const oLeft =
        other.anchor === 'middle'
          ? other.x - other.width / 2
          : other.anchor === 'end'
            ? other.x - other.width
            : other.x;
      const oRight = oLeft + other.width;
      const oTop = other.y - 10;
      const oBottom = other.y + 6;
      return (
        left < oRight + LABEL_PAD &&
        right + LABEL_PAD > oLeft &&
        top < oBottom + 4 &&
        bottom + 4 > oTop
      );
    });
    if (!hit) kept.push(item);
  }
  return kept;
}

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
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spin = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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

  const camera = useMemo(() => {
    const yaw = (view.yaw * Math.PI) / 180;
    const pitch = (view.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const radius = Math.hypot(BOX.x, BOX.y, BOX.z) / 2;
    const scale =
      Math.min(W / 2 / radius, (H / 2 / radius) * 1.25) * 0.9 * view.zoom;
    return (x: number, y: number, z: number): Screen => {
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
    () => (column: number, row: number, value: number) =>
      [
        (column / (COLS - 1) - 0.5) * BOX.x,
        (row / (ROWS - 1) - 0.5) * BOX.y,
        ((value - mesh.min) / mesh.span - 0.5) * BOX.z,
      ] as const,
    [mesh],
  );

  const quads = useMemo(() => {
    const out: { d: string; fill: string; depth: number }[] = [];
    const at = (column: number, row: number) => {
      const [x, y, z] = world(column, row, mesh.values[row][column]);
      return camera(x, y, z);
    };
    for (let row = 0; row < ROWS - 1; row++) {
      for (let column = 0; column < COLS - 1; column++) {
        const corners = [
          at(column, row),
          at(column + 1, row),
          at(column + 1, row + 1),
          at(column, row + 1),
        ];
        const mean =
          (mesh.values[row][column] +
            mesh.values[row][column + 1] +
            mesh.values[row + 1][column + 1] +
            mesh.values[row + 1][column]) /
          4;
        const lift = (mean - mesh.min) / mesh.span;
        const fill =
          mean >= 0
            ? `color-mix(in srgb, var(--pc-up) ${30 + lift * 55}%, var(--pc-void))`
            : `color-mix(in srgb, var(--pc-down) ${30 + (1 - lift) * 50}%, var(--pc-void))`;
        out.push({
          d: `M${corners.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join('L')}Z`,
          fill,
          depth: corners.reduce((sum, p) => sum + p.depth, 0) / 4,
        });
      }
    }
    return out.sort((a, b) => b.depth - a.depth);
  }, [camera, mesh, world]);

  const gridSurface = useMemo(() => {
    const gridWidth = W - FRAME.left - FRAME.right;
    const gridHeight = H - FRAME.top - FRAME.bottom;
    const cells: { x: number; y: number; fill: string }[] = [];
    for (let row = 0; row < ROWS - 1; row++) {
      for (let column = 0; column < COLS - 1; column++) {
        const mean =
          (mesh.values[row][column] +
            mesh.values[row][column + 1] +
            mesh.values[row + 1][column + 1] +
            mesh.values[row + 1][column]) /
          4;
        const lift = (mean - mesh.min) / mesh.span;
        cells.push({
          x: FRAME.left + (column * gridWidth) / (COLS - 1),
          y: FRAME.top + (row * gridHeight) / (ROWS - 1),
          fill:
            mean >= 0
              ? `color-mix(in srgb, var(--pc-up) ${32 + lift * 50}%, var(--pc-void))`
              : `color-mix(in srgb, var(--pc-down) ${34 + (1 - lift) * 46}%, var(--pc-void))`,
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
  }, [mesh]);

  const line = (points: { sx: number; sy: number }[]) =>
    points
      .map((p, index) => `${index ? 'L' : 'M'}${p.sx.toFixed(1)},${p.sy.toFixed(1)}`)
      .join(' ');

  const rowPath = (row: number) =>
    line(
      mesh.values[row].map((value, column) => {
        const [x, y, z] = world(column, row, value);
        return camera(x, y, z);
      }),
    );

  const floorZ = -BOX.z / 2;
  const zeroZ = ((0 - mesh.min) / mesh.span - 0.5) * BOX.z;
  const hx = BOX.x / 2;
  const hy = BOX.y / 2;
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

  // Prefer the near floor edges so labels stay in front of the mesh.
  const nearY =
    camera(0, hy, floorZ).depth < camera(0, -hy, floorZ).depth ? hy : -hy;
  const nearX =
    camera(hx, 0, floorZ).depth < camera(-hx, 0, floorZ).depth ? hx : -hx;
  const postX = -nearX;

  const formatDay = (timestamp: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      timestamp,
    );
  const signed = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd(Math.abs(value))}`;
  const priceDp = mesh.hi - mesh.lo < 1 ? 3 : 0;

  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const price = mesh.lo + (mesh.hi - mesh.lo) * fraction;
    return {
      label: usd(price, priceDp),
      at: corner((fraction - 0.5) * BOX.x, nearY + Math.sign(nearY) * 0.14),
      grid: [
        corner((fraction - 0.5) * BOX.x, -hy),
        corner((fraction - 0.5) * BOX.x, hy),
      ],
      gridX: FRAME.left + fraction * (W - FRAME.left - FRAME.right),
    };
  });

  const timeTicks = [0, 1].map((fraction) => ({
    label: fraction === 0 ? 'Today' : 'Expiry',
    at: corner(nearX + Math.sign(nearX) * 0.22, (fraction - 0.5) * BOX.y),
    grid: [
      corner(-hx, (fraction - 0.5) * BOX.y),
      corner(hx, (fraction - 0.5) * BOX.y),
    ],
  }));

  const post = [
    corner(postX, nearY, -BOX.z / 2),
    corner(postX, nearY, BOX.z / 2),
  ];
  const valueTicks = [mesh.min, 0, mesh.max]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => ({
      label: signed(value),
      priority: value === 0 ? 2 : 3,
      at: corner(
        postX + Math.sign(postX) * 0.16,
        nearY - Math.sign(nearY) * 0.04,
        ((value - mesh.min) / mesh.span - 0.5) * BOX.z,
      ),
    }));

  const priceTitle = corner(0, nearY + Math.sign(nearY) * 0.24, floorZ);
  const timeTitle = corner(nearX + Math.sign(nearX) * 0.38, 0, floorZ);

  const perspectiveLabels = placeLabels([
    {
      id: 'price-title',
      text: `${terms.symbol} price`,
      x: priceTitle.sx,
      y: priceTitle.sy,
      anchor: 'middle',
      className: 'title',
      priority: 1,
      width: estimateWidth(`${terms.symbol} price`),
    },
    {
      id: 'pnl-title',
      text: 'P&L',
      x: post[1].sx,
      y: post[1].sy - 12,
      anchor: 'middle',
      className: 'title',
      priority: 1,
      width: estimateWidth('P&L'),
    },
    {
      id: 'time-title',
      text: 'Time',
      x: timeTitle.sx,
      y: timeTitle.sy,
      anchor: 'middle',
      className: 'title',
      priority: 3,
      width: estimateWidth('Time'),
    },
    ...timeTicks.map((tick) => ({
      id: `time-${tick.label}`,
      text: tick.label,
      x: tick.at.sx,
      y: tick.at.sy,
      anchor: 'middle' as const,
      className: 'title',
      priority: 1,
      width: estimateWidth(tick.label),
    })),
    ...valueTicks.map((tick) => ({
      id: `value-${tick.label}`,
      text: tick.label,
      x: tick.at.sx,
      y: tick.at.sy + 4,
      anchor: (tick.at.sx > W / 2 ? 'start' : 'end') as 'start' | 'end',
      className: 'value',
      priority: tick.priority,
      width: estimateWidth(tick.label),
    })),
    ...priceTicks.map((tick, index) => ({
      id: `price-${tick.label}`,
      text: tick.label,
      x: tick.at.sx,
      y: tick.at.sy,
      anchor: 'middle' as const,
      priority: index === 0 || index === 4 ? 4 : 5,
      width: estimateWidth(tick.label),
    })),
  ]).filter(
    (label) =>
      label.x > 8 && label.x < W - 8 && label.y > 12 && label.y < H - 4,
  );

  const stopSpin = () => {
    if (spin.current) cancelAnimationFrame(spin.current);
    spin.current = null;
  };
  useEffect(() => stopSpin, []);

  const coast = (speed: number) => {
    stopSpin();
    let velocity = speed;
    const step = () => {
      velocity *= 0.94;
      if (Math.abs(velocity) < 0.02) return;
      setView((state) => ({
        ...state,
        yaw: (state.yaw + velocity + 360) % 360,
      }));
      spin.current = requestAnimationFrame(step);
    };
    spin.current = requestAnimationFrame(step);
  };

  const pointerDistance = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mode !== 'perspective') return;
    stopSpin();
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const distance = pointerDistance();
      if (distance)
        pinch.current = { distance, zoom: view.zoom };
      drag.current = null;
      return;
    }
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      yaw: view.yaw,
      pitch: view.pitch,
      last: event.clientX,
      at: performance.now(),
      speed: 0,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mode !== 'perspective') return;
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 2 && pinch.current) {
      const distance = pointerDistance();
      if (!distance) return;
      const next = Math.max(
        0.65,
        Math.min(1.85, pinch.current.zoom * (distance / pinch.current.distance)),
      );
      setView((state) => ({ ...state, zoom: next }));
      return;
    }
    const state = drag.current;
    if (!state) return;
    const now = performance.now();
    state.speed =
      ((event.clientX - state.last) * 0.4 * 16) / Math.max(1, now - state.at);
    state.last = event.clientX;
    state.at = now;
    setView((current) => ({
      ...current,
      yaw: (state.yaw + (event.clientX - state.x) * 0.4 + 3600) % 360,
      pitch: Math.max(
        4,
        Math.min(84, state.pitch + (event.clientY - state.y) * 0.3),
      ),
    }));
  };

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      const state = drag.current;
      drag.current = null;
      if (
        state &&
        performance.now() - state.at < 80 &&
        Math.abs(state.speed) > 0.3
      ) {
        coast(state.speed);
      }
    }
  };

  useEffect(() => {
    const node = svgRef.current;
    if (!node || mode !== 'perspective') return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.92 : 1.08;
      setView((state) => ({
        ...state,
        zoom: Math.max(0.65, Math.min(1.85, state.zoom * delta)),
      }));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [mode]);

  const viewDirty =
    Math.abs(view.yaw - DEFAULT_VIEW.yaw) > 0.5 ||
    Math.abs(view.pitch - DEFAULT_VIEW.pitch) > 0.5 ||
    Math.abs(view.zoom - DEFAULT_VIEW.zoom) > 0.02;

  return (
    <div className="od-surface">
      <div className="od-surface-toolbar">
        <span>Read by price and time</span>
        <div className="od-surface-toolbar-end">
          {mode === 'perspective' && viewDirty && (
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
          )}
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
              onClick={() => {
                stopSpin();
                setMode('grid');
              }}
            >
              Grid
            </button>
          </fieldset>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`od-surface-svg ${mode}`}
        aria-label={`Modelled ${terms.symbol} profit and loss across price and time`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <title>Modelled profit and loss across price and time</title>
        {mode === 'perspective' ? (
          <>
            <path d={`${line(floor)}Z`} className="od-surface-floor" />
            {priceTicks.map((tick) => (
              <path
                key={`pg-${tick.label}`}
                d={line(tick.grid)}
                className="od-surface-grid"
              />
            ))}
            {timeTicks.map((tick) => (
              <path
                key={`tg-${tick.label}`}
                d={line(tick.grid)}
                className="od-surface-grid"
              />
            ))}
            <path d={line(post)} className="od-surface-axis" />
            {quads.map((quad, index) => (
              <path
                key={index}
                d={quad.d}
                fill={quad.fill}
                className="od-surface-cell"
              />
            ))}
            <path d={`${line(zero)}Z`} className="od-surface-zero" />
            <path d={rowPath(0)} className="od-surface-edge today" />
            <path d={rowPath(ROWS - 1)} className="od-surface-edge expiry" />
            <g className="od-surface-labels">
              {perspectiveLabels.map((label) => (
                <text
                  key={label.id}
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  className={label.className}
                >
                  {label.text}
                </text>
              ))}
            </g>
          </>
        ) : (
          <>
            <rect
              x={FRAME.left}
              y={FRAME.top}
              width={gridSurface.gridWidth}
              height={gridSurface.gridHeight}
              className="od-surface-grid-frame"
            />
            {gridSurface.cells.map((cell, index) => (
              <rect
                key={index}
                x={cell.x}
                y={cell.y}
                width={gridSurface.cellWidth}
                height={gridSurface.cellHeight}
                fill={cell.fill}
                className="od-surface-cell"
              />
            ))}
            <line
              x1={FRAME.left}
              x2={FRAME.left + gridSurface.gridWidth}
              y1={FRAME.top + gridSurface.cellHeight / 2}
              y2={FRAME.top + gridSurface.cellHeight / 2}
              className="od-surface-edge today"
            />
            <line
              x1={FRAME.left}
              x2={FRAME.left + gridSurface.gridWidth}
              y1={
                FRAME.top +
                gridSurface.gridHeight -
                gridSurface.cellHeight / 2
              }
              y2={
                FRAME.top +
                gridSurface.gridHeight -
                gridSurface.cellHeight / 2
              }
              className="od-surface-edge expiry"
            />
            <g className="od-surface-labels">
              {priceTicks.map((tick) => (
                <text
                  key={tick.label}
                  x={tick.gridX}
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
              <text x={18} y={FRAME.top + 5} className="title">
                Today
              </text>
              <text
                x={18}
                y={FRAME.top + gridSurface.gridHeight + 5}
                className="title"
              >
                Expiry
              </text>
            </g>
          </>
        )}
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
        {mode === 'perspective' && (
          <span className="od-surface-hint">Drag to orbit · scroll to zoom</span>
        )}
        <span className="od-surface-range">
          {formatDay(mesh.start)} → {formatDay(mesh.expiry)} ·{' '}
          {signed(mesh.min)} to {signed(mesh.max)}
        </span>
      </div>
    </div>
  );
}
