import { historyOf, marketRows } from './market';
import { underlying } from './universe';
import { DEFAULT_UNDERLYING } from './universe';
import { add, mul } from './math';
import type { VaultBook } from './types';

export interface ValuePoint {
  date: string;
  cash: number;
  /** Shares held per underlying at that session's close. */
  shares: Record<string, number>;
  value: number;
  /** Before the vault's first movement: its opening holdings at that close. */
  backfill?: boolean;
}

/** Venue prices carry float noise; the ledger's arithmetic takes six places. */
const sixDp = (n: number | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 1e6) / 1e6;

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
export function valueSeries(
  book: VaultBook,
  /**
   * Daily closes per symbol, on the live market, where the stored price
   * file is 2025's. A symbol with none is valued at `spot` throughout.
   */
  live?: {
    closes: Record<string, { date: string; close: number }[]>;
    spot: Record<string, number>;
  },
): ValuePoint[] {
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
      new Map(
        // The replay trades from its window, but its price file starts
        // earlier; the line before the vault's first day may use it.
        (live
          ? (live.closes[symbol] ?? [])
          : [...underlying(symbol).rows, ...historyOf(symbol)]
        ).map((r) => [
          r.date,
          r.close,
        ]),
      ),
    ]),
  );
  const first = [...deltas.keys()].sort()[0] ?? today;
  const calendar = live
    ? [
        ...new Set(
          Object.values(live.closes).flatMap((rows) => rows.map((r) => r.date)),
        ),
      ]
        .sort()
        .map((date) => ({ date }))
    : marketRows;
  const points: ValuePoint[] = [];
  /* On the live market a vault is days old while its prices go back a
     year, so a range longer than its life would be one point. Before the
     first movement the line carries the opening holdings — the vault as it
     stood at the end of its first day — at each earlier close, and says so
     per point. The stored replay does the same from its own closes, so a
     vault opened today still draws the days before it. */
  {
    const open = { cash, shares: { ...shares } };
    for (const [day, d] of deltas)
      if (day <= first) {
        open.cash = add(open.cash, d.cash);
        for (const [symbol, n] of Object.entries(d.shares))
          open.shares[symbol] = add(open.shares[symbol] ?? 0, n);
      }
    const earlier = live
      ? calendar
      : [
          ...new Set(
            Object.keys(open.shares).flatMap((symbol) =>
              underlying(symbol).rows.map((r) => r.date),
            ),
          ),
        ]
          .sort()
          .map((date) => ({ date }));
    for (const row of earlier) {
      if (row.date >= first) break;
      // The replay's calendar also carries hourly test ticks.
      if (row.date.includes('T')) continue;
      let value = open.cash;
      for (const [symbol, n] of Object.entries(open.shares)) {
        if (!n) continue;
        const raw = closes.get(symbol)?.get(row.date) ?? live?.spot[symbol];
        if (raw == null) continue;
        const close = sixDp(raw);
        if (close != null) value = add(value, mul(n, close));
      }
      points.push({
        date: row.date,
        cash: open.cash,
        shares: { ...open.shares },
        value,
        backfill: true,
      });
    }
  }
  // A movement on a day with no close (a weekend deposit, on the live
  // market) lands on the next session that has one.
  const pending = [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b));
  let next = 0;
  for (const row of calendar) {
    if (row.date < first || row.date > today) continue;
    while (next < pending.length && pending[next][0] <= row.date) {
      const d = pending[next++][1];
      cash = add(cash, d.cash);
      for (const [symbol, n] of Object.entries(d.shares))
        shares[symbol] = add(shares[symbol] ?? 0, n);
    }
    let value = cash;
    for (const [symbol, n] of Object.entries(shares)) {
      if (!n) continue;
      const close = sixDp(
        closes.get(symbol)?.get(row.date) ?? live?.spot[symbol],
      );
      if (close != null) value = add(value, mul(n, close));
    }
    points.push({ date: row.date, cash, shares: { ...shares }, value });
  }
  return points;
}

/** The tail of the series a range asks for. */
export function withinRange<T>(points: T[], range: Range): T[] {
  const n = RANGES.find((r) => r.id === range)?.sessions ?? Infinity;
  return n === Infinity ? points : points.slice(-Math.max(2, n));
}

/**
 * The change across whatever is on screen.
 *
 * Measured over the drawn window rather than always against yesterday,
 * so the number under the balance is the move the line shows.
 */
export function changeOver(points: readonly Pick<ValuePoint, 'value'>[]) {
  if (points.length < 2) return null;
  const from = points[0].value,
    to = points.at(-1)!.value;
  return { amount: to - from, percent: from === 0 ? 0 : (to - from) / from };
}

/**
 * A stable vertical domain for the live vault chart.
 *
 * A balance can move by a few cents between two NBBO updates. Scaling those
 * cents to the whole panel makes ordinary quote noise look like a dramatic
 * selloff. Keep the observed extremes, but never give a portfolio less than
 * a 25 bp viewing window (or $5 for very small accounts). That preserves the
 * actual marks without turning a sub-basis-point update into chart theatre.
 */
export function valueChartDomain(
  points: readonly Pick<ValuePoint, 'value'>[],
): { lo: number; hi: number } {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (!values.length) return { lo: 0, hi: 1 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const centre = (min + max) / 2;
  const observedSpan = max - min;
  // 25 bp keeps ordinary ticks visually proportionate on a large vault.
  const floorSpan = Math.max(Math.abs(centre) * 0.0025, 5);
  const span = Math.max(observedSpan, floorSpan);
  const pad = span * 0.1;
  return { lo: centre - span / 2 - pad, hi: centre + span / 2 + pad };
}
