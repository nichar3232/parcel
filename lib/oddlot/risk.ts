import type {
  CollateralGroup,
  OptionPosition,
  RiskSummary,
  VaultBook,
} from './types';
import { units } from '../engine';
import { add, deliveries, mul } from './math';
import { mark } from './market';
// Truncation occurs per contract at settlement. Equal and opposite cash
// functions cancel exactly; integer-share coefficients have no rounding error.
function roundingCount(positions: OptionPosition[]) {
  const unmatched = new Map<string, number>();
  for (const p of positions) {
    const coefficients = new Map<string, bigint>();
    for (const leg of p.terms.legs) {
      const key = `${leg.kind}:${units(leg.strike)}`;
      const q =
        units(p.terms.quantity) *
        BigInt(leg.ratio) *
        (leg.side === 'buy' ? 1n : -1n);
      coefficients.set(key, (coefficients.get(key) || 0n) + q);
    }
    const entries = [...coefficients]
      .filter(([, q]) => q !== 0n)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.every(([, q]) => q % 1_000_000n === 0n)) continue;
    const sign = entries[0][1] < 0n ? -1n : 1n;
    const key = entries.map(([k, q]) => `${k}:${q * sign}`).join('|');
    unmatched.set(key, (unmatched.get(key) || 0) + Number(sign));
  }
  return [...unmatched.values()].reduce((sum, n) => sum + Math.abs(n), 0);
}
function envelope(positions: OptionPosition[], key: string): CollateralGroup {
  const strikes = positions.flatMap((p) => p.terms.legs.map((l) => l.strike));
  const grid = [
    ...new Set([
      0,
      ...strikes.flatMap((s) => [Math.max(0, s - 0.000001), s, s + 0.000001]),
      Math.max(...strikes) * 2 + 1,
    ]),
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
  if (positions[0].terms.settlement === 'cash' && positions.length > 1) {
    // Between strike boundaries, separately truncated cash functions can differ
    // from their sampled sum by at most n-1 base units. Reserve that allowance,
    // capped by the sum of independently sufficient isolated reserves.
    const allowance = Math.max(0, roundingCount(positions) - 1) / 1e6;
    if (allowance > 0) {
      const isolated = positions.map((p) => envelope([p], p.id));
      cash = Math.min(
        add(cash, allowance),
        isolated.reduce((s, g) => add(s, g.cash), 0),
      );
      counterpartyCash = Math.min(
        add(counterpartyCash, allowance),
        isolated.reduce((s, g) => add(s, g.counterpartyCash), 0),
      );
    }
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
