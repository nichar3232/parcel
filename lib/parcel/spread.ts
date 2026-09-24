import { liveMarket } from './market';
import { optionGreeks, round } from './math';
import { modelDays } from './market';
import type { OrderTerms } from './types';

/**
 * Modelled option liquidity around a Black–Scholes mid.
 *
 * Parcel does not consume an external listed-options book. These are therefore
 * deliberately *modelled* execution assumptions, never a claim about an
 * exchange NBBO: a two-percent quoted width per leg (with a one-cent floor),
 * 25 share-equivalents displayed at the touch, and square-root impact once an
 * order consumes more than that displayed size. Every live indication — the
 * chain, ticket, sizing helper and durable quote — reads this one schedule.
 *
 * The replay remains a deterministic mid-price model, so its historical
 * settlement assertions are unaffected.
 */
export const MODEL_LIQUIDITY = {
  width: 0.02,
  minimum: 0.01,
  displayedSize: 25,
  impactSlope: 0.5,
} as const;

/** @deprecated Use MODEL_LIQUIDITY. Kept for integrations that import it. */
export const SPREAD = MODEL_LIQUIDITY;

/** Half the quoted width, per share, around one leg's model value. */
export const halfSpread = (mid: number) =>
  Math.max(
    MODEL_LIQUIDITY.minimum / 2,
    (MODEL_LIQUIDITY.width / 2) * Math.abs(mid),
  );

/**
 * The positive dollar cost of crossing one modelled leg at `quantity`.
 *
 * The first term is the displayed half-spread. The second is a concave
 * participation penalty: splitting a 100-share order into clips does not make
 * its impact grow linearly, while a one-millionth share is not charged a full
 * displayed clip. It is calculated per leg so multi-leg structures cannot
 * accidentally receive liquidity credit from offsetting model premiums.
 */
export function legCrossingCost(mid: number, quantity: number) {
  if (!Number.isFinite(mid) || !Number.isFinite(quantity) || quantity < 0)
    throw new RangeError('Model liquidity needs a finite non-negative size.');
  if (quantity === 0) return 0;
  const touch = quantity * halfSpread(mid);
  const participation = Math.sqrt(quantity / MODEL_LIQUIDITY.displayedSize);
  return round(touch * (1 + MODEL_LIQUIDITY.impactSlope * participation));
}

/** The largest single-leg participation fraction represented by a size. */
export const liquidityParticipation = (quantity: number) =>
  quantity / MODEL_LIQUIDITY.displayedSize;

/**
 * What crossing the spread costs on a contract, in dollars, at this size.
 * Zero off the live market.
 */
export function spreadCost(
  terms: OrderTerms,
  spot: number,
  date: string,
  vol: number,
) {
  if (!liveMarket() || terms.reference !== 'stock') return 0;
  if (terms.curve) {
    // Curves have no listed legs. Price their bounded maximum payoff as the
    // model unit for the same visible-touch/participation schedule.
    return legCrossingCost(Math.abs(terms.curve.cap), terms.quantity);
  }
  const t = modelDays(date, terms.expiry);
  let cost = 0;
  for (const leg of terms.legs) {
    const mid = optionGreeks(leg.kind, spot, leg.strike, t, vol).price;
    cost += legCrossingCost(mid, terms.quantity * leg.ratio);
  }
  return round(cost);
}

/** Bid and ask around a mid premium (positive: you pay), at this size. */
export function quoteAround(mid: number, cost: number) {
  return { bid: round(mid - cost), ask: round(mid + cost) };
}
