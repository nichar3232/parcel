import { curveCash, curveGreeks } from './curves';
import {
  resolveBlackScholesModel,
  type BlackScholesModel,
} from './black-scholes';
import { units } from '../engine';
import type { Greeks, Leg, OrderTerms } from './types';
export { DEFAULT_BLACK_SCHOLES, type BlackScholesModel } from './black-scholes';
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
const density = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

const intrinsic = (kind: 'call' | 'put', s: number, k: number) =>
  Math.max(0, kind === 'call' ? s - k : k - s);

const assertModelInputs = (s: number, k: number, v: number, dayCount: number) => {
  if (!Number.isFinite(s) || s <= 0)
    throw new RangeError(
      'Black-Scholes spot must be a positive finite number.',
    );
  if (!Number.isFinite(k) || k <= 0)
    throw new RangeError(
      'Black-Scholes strike must be a positive finite number.',
    );
  if (!Number.isFinite(v) || v < 0 || v > 10)
    throw new RangeError(
      'Black-Scholes volatility must be a finite annual value from 0% to 1000%.',
    );
  if (!Number.isFinite(dayCount))
    throw new RangeError('Black-Scholes expiry must be a finite day count.');
};

function deterministicGreeks(
  kind: 'call' | 'put',
  s: number,
  k: number,
  t: number,
  model: BlackScholesModel,
): Greeks {
  const { riskFreeRate: rate, dividendYield: yieldRate } = model;
  if (t <= 0) {
    const atMoney = s === k ? 0.5 : s > k ? 1 : 0;
    return {
      price: intrinsic(kind, s, k),
      delta: kind === 'call' ? atMoney : atMoney - 1,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }
  const carry = Math.exp(-yieldRate * t);
  const discount = Math.exp(-rate * t);
  const forward = s * Math.exp((rate - yieldRate) * t);
  const inMoney = forward === k ? 0.5 : forward > k ? 1 : 0;
  const call = discount * Math.max(0, forward - k);
  const delta = carry * inMoney;
  return {
    price: kind === 'call' ? call : call - s * carry + k * discount,
    delta: kind === 'call' ? delta : delta - carry,
    gamma: 0,
    theta: 0,
    vega: 0,
  };
}

/**
 * Price and differentiate one share-equivalent option analytically.
 *
 * Vega is the dollar effect of a one-point (1%) volatility move and theta is
 * one calendar day's decay. Those are the units the ticket and chain display,
 * which keeps values proportional all the way down to Parcel's minimum size.
 */
export function optionGreeks(
  kind: 'call' | 'put',
  s: number,
  k: number,
  dayCount: number,
  v = 0.45,
  overrides: Partial<BlackScholesModel> = {},
): Greeks {
  assertModelInputs(s, k, v, dayCount);
  const model = resolveBlackScholesModel(overrides);
  const t = Math.max(0, dayCount) / 365;
  if (t === 0 || v === 0) return deterministicGreeks(kind, s, k, t, model);

  const { riskFreeRate: rate, dividendYield: yieldRate } = model;
  const rootT = Math.sqrt(t);
  const carry = Math.exp(-yieldRate * t);
  const discount = Math.exp(-rate * t);
  const d1 =
    (Math.log(s / k) + (rate - yieldRate + (v * v) / 2) * t) / (v * rootT);
  const d2 = d1 - v * rootT;
  const nd1 = normal(d1);
  const densityAtD1 = density(d1);
  const call = s * carry * nd1 - k * discount * normal(d2);
  const put = k * discount * normal(-d2) - s * carry * normal(-d1);
  const commonTheta = -(s * carry * densityAtD1 * v) / (2 * rootT);
  const thetaYear =
    kind === 'call'
      ? commonTheta -
        rate * k * discount * normal(d2) +
        yieldRate * s * carry * nd1
      : commonTheta +
        rate * k * discount * normal(-d2) -
        yieldRate * s * carry * normal(-d1);

  return {
    price: Math.max(0, kind === 'call' ? call : put),
    delta: kind === 'call' ? carry * nd1 : carry * (nd1 - 1),
    gamma: (carry * densityAtD1) / (s * v * rootT),
    theta: thetaYear / 365,
    vega: (s * carry * densityAtD1 * rootT) / 100,
  };
}
export function orderGreeks(
  terms: OrderTerms,
  s: number,
  date: string,
  vol = 0.45,
  overrides: Partial<BlackScholesModel> = {},
): Greeks {
  if (terms.curve)
    return curveGreeks(terms, s, days(date, terms.expiry), vol, overrides);
  const result: Greeks = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of terms.legs) {
    const g = optionGreeks(
      leg.kind,
      s,
      leg.strike,
      days(date, terms.expiry),
      vol,
      overrides,
    );
    const q = terms.quantity * leg.ratio * (leg.side === 'buy' ? 1 : -1);
    for (const key of Object.keys(result) as (keyof Greeks)[])
      result[key] += g[key] * q;
  }
  return result;
}
export function cashPayoff(terms: OrderTerms, s: number) {
  if (terms.curve) return Number(curveCash(terms, s)) / 1e6;
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

export function strategyPnl(
  terms: OrderTerms,
  settlementPrice: number,
  stockEntry: number,
  premium: number,
  stockQuantity = 0,
) {
  return add(
    add(cashPayoff(terms, settlementPrice), -round(premium)),
    mul(stockQuantity, round(settlementPrice - stockEntry)),
  );
}
