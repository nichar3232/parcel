import type {
  CollateralGroup,
  OptionPosition,
  RiskSummary,
  VaultBook,
} from './types';
import { add, deliveries, mul } from './math';
import { mark } from './market';
function envelope(positions: OptionPosition[], key: string): CollateralGroup {
  const strikes = positions.flatMap((p) => p.terms.legs.map((l) => l.strike));
  const grid = [
    0,
    ...strikes.flatMap((s) => [Math.max(0, s - 0.000001), s, s + 0.000001]),
    Math.max(...strikes) * 2 + 1,
  ];
  let cash = 0,
    shares = 0,
    counterpartyCash = 0,
    counterpartyShares = 0;
  for (const s of grid) {
    let c = 0,
      q = 0;
    for (const p of positions) {
      const d = deliveries(p.terms, s);
      c = add(c, d.cash);
      q = add(q, d.shares);
    }
    cash = Math.max(cash, -c);
    shares = Math.max(shares, -q);
    counterpartyCash = Math.max(counterpartyCash, c);
    counterpartyShares = Math.max(counterpartyShares, q);
  }
  return {
    key,
    expiry: positions[0].terms.expiry,
    settlement: positions[0].terms.settlement,
    positions: positions.length,
    cash,
    shares,
    counterpartyCash,
    counterpartyShares,
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
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups].map(([key, p]) => envelope(p, key));
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
    .filter((p) => p.status === 'active')
    .reduce((s, p) => add(s, p.quantity), 0);
  const shortShares = book.shorts
    .filter((p) => p.status === 'active')
    .reduce((s, p) => add(s, p.quantity), 0);
  const cash = add(total(groups, 'cash'), shortCash),
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
    counterpartyCash: total(groups, 'counterpartyCash'),
    counterpartyShares: add(
      add(total(groups, 'counterpartyShares'), shortShares),
      loanShares,
    ),
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
  if (
    book.counterparty.USDC < r.counterpartyCash ||
    book.counterparty.NVDA < r.counterpartyShares
  )
    throw Error(
      'The test counterparty has insufficient free collateral for this order.',
    );
}
