import type { OrderTerms, VaultBook } from '../../lib/parcel/types';
import { DIVIDEND, mark } from '../../lib/parcel/market';
import { orderGreeks, round } from '../../lib/parcel/math';
import { deliveryBounds, payoffBounds } from '../../lib/parcel/envelope';
import { amount, expiry, parseOrderTerms } from '../../lib/parcel/validation';
import { premium } from './ledger';

export function indicative(terms: OrderTerms, book: VaultBook) {
  const p = premium(terms, book),
    b = deliveryBounds([terms]);
  return {
    premium: p,
    cash: Number(b.cashMin < 0n ? -b.cashMin : 0n) / 1e6,
    shares: Number(b.sharesMin < 0n ? -b.sharesMin : 0n) / 1e6,
  };
}
export function optionsChain(book: VaultBook, end: unknown, quantity: unknown) {
  const selected = expiry(end, book.date),
    q = amount(quantity),
    spot = mark(book.date);
  const center = Math.round(spot / 5) * 5;
  const rows = Array.from({ length: 11 }, (_, i) => center + (i - 5) * 5)
    .filter((k) => k > 0)
    .map((strike) => ({
      strike,
      contracts: (['call', 'put'] as const).map((kind) => {
        const terms: OrderTerms = {
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
          delta: orderGreeks(valid, spot, book.date).delta,
        };
      }),
    }));
  return {
    expiry: selected,
    quantity: q,
    spot,
    rows,
    pricing: 'Model RFQ — funded test counterparty — zero model spread',
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
    if (premium(terms, book) <= 0)
      throw Error(
        'Premium budgets require a positive premium purchase. Use exposure sizing for underwriting.',
      );
    // Search actual rounded model costs, so the result cannot overspend the budget.
    let low = 0,
      high = 1_000_000_000;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = { ...terms, quantity: mid / 1e6 },
        b = payoffBounds(candidate);
      const cost =
        b.cashMin === 0n && b.cashMax === 0n ? 0 : premium(candidate, book);
      if (cost <= limit) low = mid;
      else high = mid - 1;
    }
    q = low / 1e6;
  } else if (mode === 'sensitivity') {
    const delta = Math.abs(
      orderGreeks(
        terms,
        terms.reference === 'dividend' ? DIVIDEND : mark(book.date),
        book.date,
        terms.reference === 'dividend' ? 0.8 : 0.45,
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
    sized.reference === 'dividend' ? DIVIDEND : mark(book.date),
    book.date,
    sized.reference === 'dividend' ? 0.8 : 0.45,
  );
  return {
    terms: sized,
    ...indication,
    centSensitivity: greeks.delta * 0.01,
    cashFunding: round(Math.max(0, indication.premium) + indication.cash),
    limited: q === 1000,
  };
}
