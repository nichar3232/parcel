import type {
  CollateralGroup,
  OptionPosition,
  PerSymbol,
  RiskSummary,
  VaultBook,
} from './types';
import { add, mul } from './math';
import { mark } from './market';
import { UNDERLYINGS } from './universe';
import { deliveryBounds } from './envelope';

function envelope(positions: OptionPosition[], key: string): CollateralGroup {
  const b = deliveryBounds(positions.map((p) => p.terms));
  return {
    key,
    symbol: positions[0].terms.symbol,
    cashMinimum: Number(b.cashMin) / 1e6,
    cashMaximum: Number(b.cashMax) / 1e6,
    expiry: positions[0].terms.expiry,
    settlement: positions[0].terms.settlement,
    positions: positions.length,
    cash: Number(b.cashMin < 0n ? -b.cashMin : 0n) / 1e6,
    shares: Number(b.sharesMin < 0n ? -b.sharesMin : 0n) / 1e6,
    counterpartyCash: Number(b.cashMax > 0n ? b.cashMax : 0n) / 1e6,
    counterpartyShares: Number(b.sharesMax > 0n ? b.sharesMax : 0n) / 1e6,
  };
}
/**
 * Positions that share collateral. Shares of one underlying cannot
 * deliver against a contract on another, so the symbol is part of the
 * key: two calls expiring the same day on different tokens are two
 * groups, each reserving its own stock.
 */
export function marginGroups(
  positions: OptionPosition[],
  mode: 'cross' | 'isolated',
) {
  const groups = new Map<string, OptionPosition[]>();
  for (const p of positions.filter((p) => p.status === 'active')) {
    const key =
      mode === 'isolated'
        ? p.id
        : `${p.terms.symbol}:${p.terms.reference}:${p.terms.expiry}:${p.terms.settlement}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return [...groups].map(([key, p]) => envelope(p, key));
}
// Earlier guaranteed cash receipts can finance later cash obligations. Reserve
// the largest prefix deficit, not merely the final net amount. Stock reserves
// remain delivery-based; loan escrows and protected shorts never get this credit.
export function calendarCash(groups: CollateralGroup[]) {
  const byExpiry = new Map<string, { min: number; max: number }>();
  for (const g of groups) {
    const row = byExpiry.get(g.expiry) || { min: 0, max: 0 };
    row.min = add(row.min, g.cashMinimum);
    row.max = add(row.max, g.cashMaximum);
    byExpiry.set(g.expiry, row);
  }
  let minimum = 0,
    maximum = 0,
    cash = 0,
    counterpartyCash = 0;
  for (const [, row] of [...byExpiry].sort(([a], [b]) => a.localeCompare(b))) {
    minimum = add(minimum, row.min);
    maximum = add(maximum, row.max);
    cash = Math.max(cash, -minimum);
    counterpartyCash = Math.max(counterpartyCash, maximum);
  }
  return { cash, counterpartyCash };
}

const SYMBOLS = UNDERLYINGS.map((u) => u.symbol);
const zero = (): PerSymbol => Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
const bump = (into: PerSymbol, symbol: string, amount: number) => {
  into[symbol] = add(into[symbol] ?? 0, amount);
};

export function risk(book: VaultBook): RiskSummary {
  const groups = marginGroups(book.options, book.margin),
    gross = marginGroups(book.options, 'isolated');
  const total = (gs: CollateralGroup[], k: 'cash' | 'counterpartyCash') =>
    gs.reduce((s, g) => add(s, g[k]), 0);
  const perSymbol = (
    gs: CollateralGroup[],
    k: 'shares' | 'counterpartyShares',
  ) => {
    const out = zero();
    for (const g of gs) bump(out, g.symbol, g[k]);
    return out;
  };
  const shortCash = book.shorts
    .filter((p) => p.status === 'active')
    .reduce((s, p) => add(s, add(mul(p.quantity, p.cap), p.maxInterest)), 0);
  const loanShares = zero(),
    shortShares = zero(),
    marketShares = zero();
  for (const p of book.loans.filter((p) => p.status === 'active'))
    bump(p.productive ? marketShares : loanShares, p.symbol, p.quantity);
  for (const p of book.shorts.filter((p) => p.status === 'active'))
    bump(shortShares, p.symbol, p.quantity);
  const calendar =
    book.margin === 'cross'
      ? calendarCash(groups)
      : {
          cash: total(groups, 'cash'),
          counterpartyCash: total(groups, 'counterpartyCash'),
        };
  const cash = add(calendar.cash, shortCash),
    shares = perSymbol(groups, 'shares');
  const grossCash = add(total(gross, 'cash'), shortCash),
    grossShares = perSymbol(gross, 'shares');
  const price = (symbol: string) => mark(symbol, book.date);
  const freeShares = zero();
  let collateralValue = cash,
    availableValue = add(book.vault.USDC, -cash),
    releasedValue = add(grossCash, -cash);
  for (const symbol of SYMBOLS) {
    freeShares[symbol] = add(book.vault[symbol] ?? 0, -shares[symbol]);
    // Only a symbol the book actually touches is priced; an idle one
    // contributes nothing and need not be looked up.
    if (!shares[symbol] && !freeShares[symbol] && !grossShares[symbol])
      continue;
    const p = price(symbol);
    collateralValue = add(collateralValue, mul(shares[symbol], p));
    availableValue = add(availableValue, mul(freeShares[symbol], p));
    releasedValue = add(
      releasedValue,
      mul(add(grossShares[symbol], -shares[symbol]), p),
    );
  }
  const freeCash = add(book.vault.USDC, -cash);
  const counterpartyShares = perSymbol(groups, 'counterpartyShares');
  for (const symbol of SYMBOLS)
    bump(
      counterpartyShares,
      symbol,
      add(shortShares[symbol], loanShares[symbol]),
    );
  return {
    cash,
    shares,
    grossCash,
    grossShares,
    freeCash,
    freeShares,
    collateralValue,
    availableValue,
    releasedValue,
    utilization:
      collateralValue / (collateralValue + Math.max(0, availableValue) || 1),
    counterpartyCash: calendar.counterpartyCash,
    counterpartyShares,
    marketShares,
    groups,
  };
}
export function assertCollateral(book: VaultBook) {
  const r = risk(book);
  if (r.freeCash < 0)
    throw Error(
      `This would leave the vault short of ${(-r.freeCash).toFixed(6)} USDC collateral. Deposit cash or close risk first.`,
    );
  for (const symbol of SYMBOLS) {
    if (r.freeShares[symbol] < 0)
      throw Error(
        `This requires ${(-r.freeShares[symbol]).toFixed(6)} more available ${symbol} shares. Deposit shares or close risk first.`,
      );
    if ((book.market[symbol] ?? 0) < r.marketShares[symbol])
      throw Error(
        'The market shares backing loan protection must remain reserved.',
      );
    if ((book.counterparty[symbol] ?? 0) < r.counterpartyShares[symbol])
      throw Error(
        'The test counterparty has insufficient free collateral for this order.',
      );
  }
  if (book.counterparty.USDC < r.counterpartyCash)
    throw Error(
      'The test counterparty has insufficient free collateral for this order.',
    );
}
