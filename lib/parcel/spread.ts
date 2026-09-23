import { liveMarket } from './market';
import { days, optionGreeks, round } from './math';
import type { OrderTerms } from './types';

/**
 * The quoted spread around a model mid.
 *
 * Every contract on the live market is quoted two ways: an ask a buyer
 * pays and a bid a writer receives. Each option leg is quoted 2% wide
 * around its own model value, never narrower than a cent a share, the
 * way a listed chain quotes a liquid name. A structure pays the spread
 * on every leg, which is what trading its legs separately would cost.
 *
 * The 2025 replay is quoted at the model mid with no spread, exactly as
 * it always was; its settlement tests are written against that.
 */
export const SPREAD = { width: 0.02, minimum: 0.01 } as const;

/** Half the quoted width, per share, around one leg's model value. */
export const halfSpread = (mid: number) =>
  Math.max(SPREAD.minimum / 2, (SPREAD.width / 2) * Math.abs(mid));

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
    const width = Math.abs(terms.curve.cap) * terms.quantity;
    return round(Math.max(terms.quantity * (SPREAD.minimum / 2), width * 0.01));
  }
  const t = days(date, terms.expiry);
  let cost = 0;
  for (const leg of terms.legs) {
    const mid = optionGreeks(leg.kind, spot, leg.strike, t, vol).price;
    cost += terms.quantity * leg.ratio * halfSpread(mid);
  }
  return round(cost);
}

/** Bid and ask around a mid premium (positive: you pay), at this size. */
export function quoteAround(mid: number, cost: number) {
  return { bid: round(mid - cost), ask: round(mid + cost) };
}
