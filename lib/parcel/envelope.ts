import { curveCap } from './curves';
import { units } from '../engine';
import { bounded, round } from './math';
import type { OrderTerms } from './types';
const SCALE = 1_000_000n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);
interface Event {
  slope: bigint;
  putCash: bigint;
  putShares: bigint;
  callCash: bigint;
  callShares: bigint;
}
export interface Bounds {
  cashMin: bigint;
  cashMax: bigint;
  sharesMin: bigint;
  sharesMax: bigint;
}

// A sorted sweep over strikes. Cash functions are continuous before contract-level
// truncation; physical delivery has separate at-strike and after-strike states.
// All arithmetic here stays in integer base units, including strike locations.
function sweep(terms: OrderTerms[], physical: boolean): Bounds {
  const events = new Map<bigint, Event>();
  let cash = 0n,
    slope = 0n,
    shares = 0n;
  for (const t of terms)
    for (const l of t.legs) {
      const k = units(l.strike),
        q = units(t.quantity) * BigInt(l.ratio) * (l.side === 'buy' ? 1n : -1n);
      const e = events.get(k) || {
        slope: 0n,
        putCash: 0n,
        putShares: 0n,
        callCash: 0n,
        callShares: 0n,
      };
      if (!physical) {
        if (l.kind === 'put') {
          cash += q * k;
          slope -= q;
        }
        e.slope += q;
      } else if (l.kind === 'put') {
        const c = (q * k) / SCALE;
        cash += c;
        shares -= q;
        e.putCash -= c;
        e.putShares += q;
      } else {
        e.callCash -= (q * k) / SCALE;
        e.callShares += q;
      }
      events.set(k, e);
    }
  let cashMin = cash,
    cashMax = cash,
    sharesMin = shares,
    sharesMax = shares,
    previous = 0n;
  const observe = () => {
    cashMin = min(cashMin, cash);
    cashMax = max(cashMax, cash);
    sharesMin = min(sharesMin, shares);
    sharesMax = max(sharesMax, shares);
  };
  for (const [k, e] of [...events].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!physical) {
      cash += slope * (k - previous);
      observe();
      slope += e.slope;
    } else {
      cash += e.putCash;
      shares += e.putShares;
      observe();
      cash += e.callCash;
      shares += e.callShares;
      observe();
    }
    previous = k;
  }
  if (!physical) {
    // Nonzero call tails are admitted only for physical delivery. This tail
    // observation is also useful for rejecting economically empty structures.
    cash += slope * (previous + SCALE);
    observe();
    cashMin /= SCALE;
    cashMax /= SCALE;
  }
  return { cashMin, cashMax, sharesMin, sharesMax };
}

function unmatchedFractionalCount(terms: OrderTerms[]) {
  const unmatched = new Map<string, number>();
  for (const t of terms) {
    const coefficients = new Map<string, bigint>();
    for (const l of t.legs) {
      const key = `${l.kind}:${units(l.strike)}`;
      coefficients.set(
        key,
        (coefficients.get(key) || 0n) +
          units(t.quantity) * BigInt(l.ratio) * (l.side === 'buy' ? 1n : -1n),
      );
    }
    const entries = [...coefficients]
      .filter(([, q]) => q !== 0n)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.every(([, q]) => q % SCALE === 0n)) continue;
    const sign = entries[0][1] < 0n ? -1n : 1n;
    const key = entries.map(([k, q]) => `${k}:${q * sign}`).join('|');
    unmatched.set(key, (unmatched.get(key) || 0) + Number(sign));
  }
  return [...unmatched.values()].reduce((sum, n) => sum + Math.abs(n), 0);
}
export function payoffBounds(terms: OrderTerms): Bounds {
  if (terms.curve) {
    const cap = curveCap(terms);
    return {
      cashMin: terms.curve.side === 'sell' ? -cap : 0n,
      cashMax: terms.curve.side === 'buy' ? cap : 0n,
      sharesMin: 0n,
      sharesMax: 0n,
    };
  }
  return sweep([terms], false);
}

/**
 * Clamp an open premium to the cash envelope the Parcel program enforces on
 * `Action::Open` for bounded claims (net call ratio zero) and curves. Naked
 * options are left unconstrained. Live modelled crossing cannot push a debit
 * past max payable value or a credit past max loss — the same rule the
 * on-chain vault rejects as `InvalidTerms`.
 */
export function clampExecutablePremium(terms: OrderTerms, value: number) {
  if (!Number.isFinite(value))
    throw new RangeError('Executable premium must be finite.');
  if (!terms.curve && !bounded(terms.legs)) return value;
  const bounds = payoffBounds(terms);
  const lo = Math.min(0, Number(bounds.cashMin) / 1e6);
  const hi = Math.max(0, Number(bounds.cashMax) / 1e6);
  return Math.max(lo, Math.min(hi, round(value)));
}
export function deliveryBounds(terms: OrderTerms[]): Bounds {
  if (!terms.length)
    return { cashMin: 0n, cashMax: 0n, sharesMin: 0n, sharesMax: 0n };
  if (terms.some((t) => t.curve)) {
    const base = deliveryBounds(terms.filter((t) => !t.curve));
    // Only identical opposite curves cancel. No sampled extrema or assumed
    // correlations may release reserve for different nonlinear payoffs.
    const pairs = new Map<string, { terms: OrderTerms; count: number }>();
    for (const t of terms.filter((t) => t.curve)) {
      const c = t.curve!;
      const key = JSON.stringify([
        t.quantity,
        c.shape,
        c.direction,
        c.lower,
        c.upper,
        c.cap,
      ]);
      const p = pairs.get(key) || { terms: t, count: 0 };
      p.count += c.side === 'buy' ? 1 : -1;
      pairs.set(key, p);
    }
    for (const { terms: t, count } of pairs.values()) {
      const cap = curveCap(t) * BigInt(count);
      base.cashMin += min(cap, 0n);
      base.cashMax += max(cap, 0n);
    }
    return base;
  }
  const physical = terms[0].settlement === 'physical';
  const bound = sweep(terms, physical);
  if (physical || terms.length === 1) return bound;
  // Bound sum(trunc(contract)) using trunc(sum(contract)) at analytic extrema.
  // Their difference at any price is at most n-1 base units. Never apply this
  // allowance to an already-rounded sample of the individual contracts.
  const allowance = BigInt(Math.max(0, unmatchedFractionalCount(terms) - 1));
  const isolated = terms.map((t) => sweep([t], false));
  const grossMin = isolated.reduce((s, b) => s + min(0n, b.cashMin), 0n);
  const grossMax = isolated.reduce((s, b) => s + max(0n, b.cashMax), 0n);
  return {
    ...bound,
    cashMin: max(grossMin, bound.cashMin - allowance),
    cashMax: min(grossMax, bound.cashMax + allowance),
  };
}
