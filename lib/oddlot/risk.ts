import type {
  CollateralGroup,
  OptionPosition,
  RiskSummary,
  VaultBook,
} from './types';
import { add, mul } from './math';
import { mark } from './market';
import { deliveryBounds } from './envelope';
function envelope(positions: OptionPosition[], key: string): CollateralGroup {
  const b = deliveryBounds(positions.map((p) => p.terms));
  return {
    key,
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
export function marginGroups(
  positions: OptionPosition[],
  mode: 'cross' | 'isolated',
) {
  const groups = new Map<string, OptionPosition[]>();
  for (const p of positions.filter((p) => p.status === 'active')) {
    const key =
      mode === 'isolated'
        ? p.id
        : `${p.terms.reference}:${p.terms.expiry}:${p.terms.settlement}`;
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
export function risk(book: VaultBook): RiskSummary {
  const groups = marginGroups(book.options, book.margin),
    gross = marginGroups(book.options, 'isolated');
  const total = (
    gs: CollateralGroup[],
    k: 'cash' | 'shares' | 'counterpartyCash' | 'counterpartyShares',
  ) => gs.reduce((s, g) => add(s, g[k]), 0);
  const shortCash = book.shorts
    .filter((p) => p.status === 'active')
    .reduce((s, p) => add(s, add(mul(p.quantity, p.cap), p.maxInterest)), 0);
  const loanShares = book.loans
    .filter((p) => p.status === 'active' && !p.productive)
    .reduce((s, p) => add(s, p.quantity), 0);
  const shortShares = book.shorts
    .filter((p) => p.status === 'active')
    .reduce((s, p) => add(s, p.quantity), 0);
  const calendar =
    book.margin === 'cross'
      ? calendarCash(groups)
      : {
          cash: total(groups, 'cash'),
          counterpartyCash: total(groups, 'counterpartyCash'),
        };
  const cash = add(calendar.cash, shortCash),
    shares = total(groups, 'shares');
  const grossCash = add(total(gross, 'cash'), shortCash),
    grossShares = total(gross, 'shares');
  const price = mark(book.date),
    collateralValue = add(cash, mul(shares, price));
  const freeCash = add(book.vault.USDC, -cash),
    freeShares = add(book.vault.NVDA, -shares);
  const availableValue = add(freeCash, mul(freeShares, price));
  return {
    cash,
    shares,
    grossCash,
    grossShares,
    freeCash,
    freeShares,
    collateralValue,
    availableValue,
    releasedValue: add(
      add(grossCash, -cash),
      mul(add(grossShares, -shares), price),
    ),
    utilization:
      collateralValue / (collateralValue + Math.max(0, availableValue) || 1),
    counterpartyCash: calendar.counterpartyCash,
    counterpartyShares: add(
      add(total(groups, 'counterpartyShares'), shortShares),
      loanShares,
    ),
    marketShares: book.loans
      .filter((p) => p.status === 'active' && p.productive)
      .reduce((s, p) => add(s, p.quantity), 0),
    groups,
  };
}
export function assertCollateral(book: VaultBook) {
  const r = risk(book);
  if (r.freeCash < 0)
    throw Error(
      `This would leave the vault short of ${(-r.freeCash).toFixed(6)} USDC collateral. Deposit cash or close risk first.`,
    );
  if (r.freeShares < 0)
    throw Error(
      `This requires ${(-r.freeShares).toFixed(6)} more available NVDA shares. Deposit shares or close risk first.`,
    );
  if (book.market.NVDA < r.marketShares)
    throw Error(
      'The market shares backing loan protection must remain reserved.',
    );
  if (
    book.counterparty.USDC < r.counterpartyCash ||
    book.counterparty.NVDA < r.counterpartyShares
  )
    throw Error(
      'The test counterparty has insufficient free collateral for this order.',
    );
}
