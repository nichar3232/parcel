import { units } from '../engine';
import type { CurveTerms, Greeks, OrderTerms } from './types';

// Protocol-defined 12-decimal curve fractions. The exponential is the
// deterministic 32-term series for exp(4x), normalized by that same series at 4.
// TS and Rust deliberately use the same integer divisions, in the same order.
const F = 1_000_000_000_000n;
function expFixed(x: bigint) {
  let term = F,
    sum = F;
  for (let n = 1n; n <= 32n; n++) {
    term = (term * x) / (F * n);
    sum += term;
    if (term === 0n) break;
  }
  return sum;
}
const EXP_RANGE = expFixed(4n * F) - F;
export function curveCap(t: OrderTerms) {
  return (units(t.quantity) * units(t.curve!.cap)) / 1_000_000n;
}
export function curveCash(t: OrderTerms, price: number): bigint {
  const c = t.curve!,
    low = units(c.lower),
    high = units(c.upper);
  const p = units(Math.max(0, Math.round(price * 1e6) / 1e6));
  const clipped = p < low ? low : p > high ? high : p;
  const distance = c.direction === 'up' ? clipped - low : high - clipped;
  const x = (distance * F) / (high - low);
  const fraction =
    c.shape === 'quadratic'
      ? (x * x) / F
      : ((expFixed(4n * x) - F) * F) / EXP_RANGE;
  return ((curveCap(t) * fraction) / F) * (c.side === 'buy' ? 1n : -1n);
}
function shape(c: CurveTerms, price: number) {
  let x = Math.max(0, Math.min(1, (price - c.lower) / (c.upper - c.lower)));
  if (c.direction === 'down') x = 1 - x;
  return c.shape === 'quadratic' ? x * x : Math.expm1(4 * x) / Math.expm1(4);
}
// Fixed quadrature of the disclosed lognormal test model. Settlement never
// uses floating-point quadrature; its obligation is defined by curveCash.
function model(c: CurveTerms, spot: number, days: number, vol: number) {
  const time = Math.max(0, days) / 365;
  if (!time) return shape(c, spot) * c.cap;
  let sum = 0;
  const steps = 256,
    dz = 16 / steps;
  for (let i = 0; i <= steps; i++) {
    const z = -8 + i * dz;
    const price =
      spot *
      Math.exp((0.04 - (vol * vol) / 2) * time + vol * Math.sqrt(time) * z);
    sum +=
      ((i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) *
        shape(c, price) *
        Math.exp((-z * z) / 2)) /
      Math.sqrt(2 * Math.PI);
  }
  return ((sum * dz) / 3) * c.cap * Math.exp(-0.04 * time);
}
export function curveGreeks(
  t: OrderTerms,
  spot: number,
  days: number,
  vol: number,
): Greeks {
  const c = t.curve!,
    step = Math.max(0.000001, spot * 0.001);
  const price = model(c, spot, days, vol),
    up = model(c, spot + step, days, vol),
    down = model(c, Math.max(0.000001, spot - step), days, vol);
  const q = t.quantity * (c.side === 'buy' ? 1 : -1);
  return {
    price: price * q,
    delta: ((up - down) / (2 * step)) * q,
    gamma: ((up - 2 * price + down) / (step * step)) * q,
    theta: (model(c, spot, Math.max(0, days - 1), vol) - price) * q,
    vega: (model(c, spot, days, vol + 0.01) - price) * q,
  };
}
