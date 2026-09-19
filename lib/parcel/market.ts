import { DEFAULT_UNDERLYING, UNDERLYINGS, underlying } from './universe';
import type { SessionRow } from './universe';

/** The first session of the replay window. */
export const WINDOW_OPENS = '2025-01-24';

/** NVDA's sessions, which set the calendar every underlying shares. */
export const marketRows = underlying(DEFAULT_UNDERLYING).rows.filter(
  (r) => r.date >= WINDOW_OPENS,
);

// Hourly observations carry forward that day's committed close. They are test
// clock ticks, never claimed to be historical intraday market prices. Daily
// indices remain stable for archived evidence; appended indices sort by time.
function withClock(rows: SessionRow[]) {
  return [
    ...rows,
    ...rows.slice(0, -1).flatMap((r) =>
      Array.from({ length: 23 }, (_, i) => ({
        ...r,
        date: `${r.date}T${String(i + 1).padStart(2, '0')}:00:00Z`,
      })),
    ),
  ];
}

const clocks = new Map(
  UNDERLYINGS.map((u) => [
    u.symbol,
    withClock(u.rows.filter((r) => r.date >= WINDOW_OPENS)),
  ]),
);

export const clockRows = clocks.get(DEFAULT_UNDERLYING)!;
export const clockDates = clockRows.map((r) => r.date).sort();
export const DIVIDEND_DATE = '2025-03-12';
export const DIVIDEND = 0.01;
export const VOLATILITY = 0.45;

/** The committed close of one underlying at one observation. */
export function mark(symbol: string, date: string) {
  const rows = clocks.get(symbol);
  if (!rows) throw Error(`Choose a supported underlying, not ${symbol}.`);
  const row = rows.find((r) => r.date === date);
  if (!row) throw Error('Choose an available market session.');
  return row.close;
}

/** The model volatility a symbol's contracts are priced at. */
export const volatility = (symbol: string) => underlying(symbol).volatility;

/** The window's daily closes for one underlying. */
export const historyOf = (symbol: string) =>
  underlying(symbol).rows.filter((r) => r.date >= WINDOW_OPENS);

export function expiries(date: string) {
  return marketRows.filter((r) => r.date > date).map((r) => r.date);
}

export function shortExpiries(date: string) {
  const now = Date.parse(date);
  return clockDates.filter(
    (d) =>
      d.includes('T') &&
      Date.parse(d) > now &&
      Date.parse(d) <= now + 24 * 3600000,
  );
}

/**
 * The expiries a contract can actually be written to.
 *
 * Sessions only. Five of the test clock's hourly ticks used to be
 * mixed in among the dates, which put "02/14/2025 at 01:00 UTC" in a
 * dropdown beside "02/18/2025" — an intraday expiry offered against a
 * price file that holds one committed close per day. The clock still
 * ticks hourly and contracts still settle at the exact observation
 * they expire on; there is just nothing to gain from letting someone
 * pick one.
 */
export function selectableExpiries(date: string) {
  return expiries(date);
}
