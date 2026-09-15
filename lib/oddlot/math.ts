import { units } from '../engine';
import type { Greeks, Leg, OrderTerms } from './types';
export const round = (n: number) => Math.round(n * 1e6) / 1e6;
export const signedUnits = (n: number) => (n < 0 ? -units(-n) : units(n));
export const add = (a: number, b: number) =>
  Number(signedUnits(a) + signedUnits(b)) / 1e6;
export const mul = (a: number, b: number) =>
  Number((signedUnits(a) * signedUnits(b)) / 1_000_000n) / 1e6;
export const days = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86400000;
const normal = (x: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    1 -
    d *
      t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
};
function value(
  kind: 'call' | 'put',
  s: number,
  k: number,
  t: number,
  v: number,
) {
  if (t <= 0) return Math.max(0, kind === 'call' ? s - k : k - s);
  const d1 = (Math.log(s / k) + (0.04 + (v * v) / 2) * t) / (v * Math.sqrt(t));
  const d2 = d1 - v * Math.sqrt(t);
  return Math.max(
    0,
    kind === 'call'
      ? s * normal(d1) - k * Math.exp(-0.04 * t) * normal(d2)
      : k * Math.exp(-0.04 * t) * normal(-d2) - s * normal(-d1),
  );
}
export function optionGreeks(
  kind: 'call' | 'put',
  s: number,
  k: number,
  dayCount: number,
  v = 0.45,
): Greeks {
  const t = Math.max(0, dayCount) / 365;
  const price = value(kind, s, k, t, v),
    step = s * 0.001;
  return {
    price,
    delta:
      (value(kind, s + step, k, t, v) - value(kind, s - step, k, t, v)) /
      (2 * step),
    gamma:
      (value(kind, s + step, k, t, v) -
        2 * price +
        value(kind, s - step, k, t, v)) /
      (step * step),
    theta: value(kind, s, k, Math.max(0, t - 1 / 365), v) - price,
    vega: value(kind, s, k, t, v + 0.01) - price,
  };
}
export function orderGreeks(
  terms: OrderTerms,
  s: number,
  date: string,
  vol = 0.45,
): Greeks {
  const result: Greeks = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of terms.legs) {
    const g = optionGreeks(
      leg.kind,
      s,
      leg.strike,
      days(date, terms.expiry),
      vol,
    );
    const q = terms.quantity * leg.ratio * (leg.side === 'buy' ? 1 : -1);
    for (const key of Object.keys(result) as (keyof Greeks)[])
      result[key] += g[key] * q;
  }
  return result;
}
export function cashPayoff(terms: OrderTerms, s: number) {
  let numerator = 0n;
  for (const l of terms.legs) {
    const intrinsic = Math.max(
      0,
      l.kind === 'call' ? s - l.strike : l.strike - s,
    );
    numerator +=
      signedUnits(round(intrinsic)) *
      signedUnits(terms.quantity) *
      BigInt(l.ratio) *
      (l.side === 'buy' ? 1n : -1n);
  }
  return Number(numerator / 1_000_000n) / 1e6;
}
export function deliveries(terms: OrderTerms, s: number) {
  if (terms.settlement === 'cash')
    return { cash: cashPayoff(terms, s), shares: 0 };
  let cash = 0,
    shares = 0;
  for (const l of terms.legs) {
    if (l.kind === 'call' ? s <= l.strike : s >= l.strike) continue;
    const q =
      mul(terms.quantity, l.ratio) *
      (l.side === 'buy' ? 1 : -1) *
      (l.kind === 'call' ? 1 : -1);
    shares = add(shares, q);
    cash = add(cash, -mul(q, l.strike));
  }
  return { cash, shares };
}
export function bounded(legs: Leg[]) {
  return (
    Math.abs(
      legs.reduce(
        (s, l) =>
          s + (l.kind === 'call' ? l.ratio * (l.side === 'buy' ? 1 : -1) : 0),
        0,
      ),
    ) < 1e-9
  );
}
