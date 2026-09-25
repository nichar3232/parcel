import type { OrderTerms, VaultBook } from '../../lib/parcel/types';
import { DIVIDEND, mark, volatility } from '../../lib/parcel/market';
import { DEFAULT_UNDERLYING } from '../../lib/parcel/universe';
import { orderGreeks, round } from '../../lib/parcel/math';
import { deliveryBounds, payoffBounds } from '../../lib/parcel/envelope';
import { MODEL_LIQUIDITY } from '../../lib/parcel/spread';
import { amount, expiry, parseOrderTerms } from '../../lib/parcel/validation';
import { tradedPremium } from './ledger';

export function indicative(terms: OrderTerms, book: VaultBook) {
  // The price you would trade at: the ask to buy, the bid to write.
  // Same schedule as the funded quote and the durable fill.
  const p = tradedPremium(terms, book),
    b = deliveryBounds([terms]);
  return {
    premium: p,
    cash: Number(b.cashMin < 0n ? -b.cashMin : 0n) / 1e6,
    shares: Number(b.sharesMin < 0n ? -b.sharesMin : 0n) / 1e6,
  };
}
/**
 * The strikes a chain actually lists.
 *
 * Listed equity options are not evenly spaced. The exchanges open
 * strikes densely around the money and thin them out as they go, so a
 * reader working near spot gets the resolution to pick a level and is
 * not made to scroll through fifty far-out-of-the-money lines to reach
 * it. This follows the same convention: $2.50 inside 10% of spot, $5
 * out to 25%, $10 beyond, walked outward from the nearest $2.50 so
 * every strike sits on a real increment rather than on a grid derived
 * from today's price.
 *
 * It replaces eleven strikes at a flat $5, which could not express
 * $122.50 — or any other half-step — at all.
 */
export function strikeLadder(spot: number, reach = 0.32) {
  // Each interval has its own grid: a $5 strike is a multiple of five,
  // a $10 strike a multiple of ten. Walking outward by a changing step
  // instead carries the starting offset all the way out, which is how
  // a chain ends up listing $157.50 and $162.50 where every real one
  // lists $160 and $165.
  const bands = [
    { step: 2.5, from: 0, to: 0.1 },
    { step: 5, from: 0.1, to: 0.25 },
    { step: 10, from: 0.25, to: reach },
  ];
  const out = new Set<number>();
  for (const band of bands) {
    const first = Math.ceil((spot * (1 - band.to)) / band.step) * band.step;
    for (let k = first; k <= spot * (1 + band.to); k += band.step) {
      const away = Math.abs(k / spot - 1);
      if (k > 0 && away >= band.from && away < band.to)
        out.add(Math.round(k * 100) / 100);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function optionsChain(
  book: VaultBook,
  end: unknown,
  quantity: unknown,
  symbol = DEFAULT_UNDERLYING,
) {
  const selected = expiry(end, book.date),
    q = amount(quantity),
    spot = mark(symbol, book.date);
  const rows = strikeLadder(spot).map((strike) => ({
    strike,
    contracts: (['call', 'put'] as const).map((kind) => {
      const terms: OrderTerms = {
        symbol,
        name: `${kind === 'call' ? 'Call' : 'Put'} ${strike}`,
        quantity: q,
        expiry: selected,
        settlement: 'physical',
        reference: 'stock',
        legs: [{ kind, side: 'buy', strike, ratio: 1 }],
      };
      const valid = parseOrderTerms(terms, book.date);
      return {
        kind,
        buy: indicative(valid, book),
        sell: indicative(
          { ...valid, legs: [{ ...valid.legs[0], side: 'sell' }] },
          book,
        ),
        delta: orderGreeks(valid, spot, book.date, volatility(symbol)).delta,
      };
    }),
  }));
  return {
    symbol,
    expiry: selected,
    quantity: q,
    spot,
    // Modelled share-equivalents displayed at the touch — the same
    // participation depth that drives size impact. Not exchange volume.
    displayedSize: MODEL_LIQUIDITY.displayedSize,
    rows,
    pricing:
      'Black–Scholes model mid with per-leg bid/ask and size impact · funded test counterparty · not an external options book',
  };
}
export function sizeOrder(
  book: VaultBook,
  value: unknown,
  mode: unknown,
  target: unknown,
) {
  const terms = parseOrderTerms(
    { ...(value as Record<string, unknown>), quantity: 1 },
    book.date,
  );
  const limit = amount(target, 0.000001, 1_000_000);
  let q: number;
  if (mode === 'exposure') q = amount(limit);
  else if (mode === 'premium') {
    if (indicative(terms, book).premium <= 0)
      throw Error(
        'Premium budgets require a positive premium purchase. Use exposure sizing for underwriting.',
      );
    // Search the same rounded ask shown in the chain and charged by a durable
    // quote. Sizing on the mid would promise a quantity which exceeds the
    // selected cash budget once its per-leg spread and participation impact
    // are applied.
    let low = 0,
      high = 1_000_000_000;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = { ...terms, quantity: mid / 1e6 },
        b = payoffBounds(candidate);
      const cost =
        b.cashMin === 0n && b.cashMax === 0n
          ? 0
          : indicative(candidate, book).premium;
      if (cost <= limit) low = mid;
      else high = mid - 1;
    }
    q = low / 1e6;
  } else if (mode === 'sensitivity') {
    const delta = Math.abs(
      orderGreeks(
        terms,
        terms.reference === 'dividend'
          ? DIVIDEND
          : mark(terms.symbol, book.date),
        book.date,
        terms.reference === 'dividend' ? 0.8 : volatility(terms.symbol),
      ).delta,
    );
    if (delta < 1e-9)
      throw Error(
        'This contract has negligible local delta. Use exposure or premium sizing.',
      );
    q = Math.min(1000, Math.floor((limit / (delta * 0.01)) * 1e6) / 1e6);
  } else throw Error('Choose exposure, premium, or sensitivity sizing.');
  const sized = parseOrderTerms({ ...terms, quantity: q }, book.date);
  const indication = indicative(sized, book);
  const greeks = orderGreeks(
    sized,
    sized.reference === 'dividend' ? DIVIDEND : mark(sized.symbol, book.date),
    book.date,
    sized.reference === 'dividend' ? 0.8 : volatility(sized.symbol),
  );
  return {
    terms: sized,
    ...indication,
    centSensitivity: greeks.delta * 0.01,
    cashFunding: round(Math.max(0, indication.premium) + indication.cash),
    limited: q === 1000,
  };
}
