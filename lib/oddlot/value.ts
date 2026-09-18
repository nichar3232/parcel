import { historyOf, marketRows } from './market';
import { DEFAULT_UNDERLYING } from './universe';
import { add, mul } from './math';
import type { VaultBook } from './types';

export interface ValuePoint {
  date: string;
  cash: number;
  /** Shares held per underlying at that session's close. */
  shares: Record<string, number>;
  value: number;
}

export type Range = '1W' | '1M' | '3M' | 'ALL';

export const RANGES: { id: Range; label: string; sessions: number }[] = [
  { id: '1W', label: '1W', sessions: 5 },
  { id: '1M', label: '1M', sessions: 21 },
  { id: '3M', label: '3M', sessions: 63 },
  { id: 'ALL', label: 'ALL', sessions: Infinity },
];

/**
 * What the vault has been worth, session by session.
 *
 * Reconstructed rather than stored. Every movement of cash or stock is
 * already in the ledger as a signed delta against the vault, so the
 * balance at the end of any past session is the balance now with every
 * later delta unwound. Valuing each of those balances at that session's
 * committed close, per underlying, gives the line.
 *
 * Two things this deliberately does not do. It does not value the open
 * contracts: the headline is cash plus stock, and a line that included
 * marks would not end on the number printed above it. And it does not
 * run before the vault existed — the first point is the session of the
 * first ledger entry, not the start of the price file. Valuing today's
 * holdings at January's closes would draw a backtest of a position
 * nobody held, which is not what a balance history is.
 */
export function valueSeries(book: VaultBook): ValuePoint[] {
  const today = book.date.slice(0, 10);
  type Delta = { cash: number; shares: Record<string, number> };
  const deltas = new Map<string, Delta>();
  for (const e of book.events) {
    const day = e.date.slice(0, 10);
    const at = deltas.get(day) ?? { cash: 0, shares: {} };
    const symbol = e.symbol ?? DEFAULT_UNDERLYING;
    at.cash = add(at.cash, e.cash);
    at.shares[symbol] = add(at.shares[symbol] ?? 0, e.shares);
    deltas.set(day, at);
  }

  // Unwind to the balance the vault opened its first session on, then
  // replay forward. Backwards would produce the same numbers in the
  // wrong order and leave the rounding on the oldest point.
  let cash = book.vault.USDC;
  const shares: Record<string, number> = {};
  for (const [symbol, amount] of Object.entries(book.vault))
    if (symbol !== 'USDC' && amount) shares[symbol] = amount;
  for (const d of deltas.values()) {
    cash = add(cash, -d.cash);
    for (const [symbol, n] of Object.entries(d.shares))
      shares[symbol] = add(shares[symbol] ?? 0, -n);
  }

  const closes = new Map(
    Object.keys(shares).map((symbol) => [
      symbol,
      new Map(historyOf(symbol).map((r) => [r.date, r.close])),
    ]),
  );
  const first = [...deltas.keys()].sort()[0] ?? today;
  const points: ValuePoint[] = [];
  for (const row of marketRows) {
    if (row.date < first || row.date > today) continue;
    const d = deltas.get(row.date);
    if (d) {
      cash = add(cash, d.cash);
      for (const [symbol, n] of Object.entries(d.shares))
        shares[symbol] = add(shares[symbol] ?? 0, n);
    }
    let value = cash;
    for (const [symbol, n] of Object.entries(shares)) {
      if (!n) continue;
      const close = closes.get(symbol)?.get(row.date);
      if (close != null) value = add(value, mul(n, close));
    }
    points.push({ date: row.date, cash, shares: { ...shares }, value });
  }
  return points;
}

/** The tail of the series a range asks for. */
export function withinRange(points: ValuePoint[], range: Range) {
  const n = RANGES.find((r) => r.id === range)?.sessions ?? Infinity;
  return n === Infinity ? points : points.slice(-Math.max(2, n));
}

/**
 * The change across whatever is on screen.
 *
 * Measured over the drawn window rather than always against yesterday,
 * so the number under the balance is the move the line shows.
 */
export function changeOver(points: ValuePoint[]) {
  if (points.length < 2) return null;
  const from = points[0].value,
    to = points.at(-1)!.value;
  return { amount: to - from, percent: from === 0 ? 0 : (to - from) / from };
}
