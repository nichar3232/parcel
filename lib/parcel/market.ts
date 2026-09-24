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

/**
 * The live market, when the server runs on one.
 *
 * The desk was built on a replay of stored 2025 closes: the clock was a
 * session date, every price was that session's close and every contract
 * settled at a close already in the file. Live, the clock is now, a price
 * is the current mark and a contract settles at the close recorded on its
 * expiry day. The ledger reads both through `mark`: an instant is priced
 * at the live mark, a calendar date at that day's recorded close.
 *
 * Only the server installs one. Without it — the test suite, the browser —
 * everything here is the replay, unchanged.
 */
export interface LiveMarket {
  /** The current mark, or null if none has been observed yet. */
  spot(symbol: string): number | null;
  /** The recorded close on a date, or null until it is final. */
  close(symbol: string, date: string): number | null;
  /** The expiry dates a contract can be written to, after `now`. */
  expiries(now: string): string[];
  /**
   * A fresh executable bid and ask. A delayed mark, oracle mark, or modelled
   * spread must return null here rather than being passed off as a venue book.
   */
  quote?(
    symbol: string,
  ): { bid: number; ask: number; bidSize?: number; askSize?: number } | null;
}
let live: LiveMarket | null = null;
export function setLiveMarket(market: LiveMarket | null) {
  live = market;
}
export const liveMarket = () => live;
/** An instant rather than a calendar date: a live clock reading. */
const instant = (date: string) => date.length > 10;

const newYorkHour = (at: number) => {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(at)
    .find((value) => value.type === 'hour')?.value;
  return Number(part) % 24;
};

/**
 * The listed-equity expiry instant for a calendar expiry date.
 *
 * Contracts displayed as (for example) `2026-10-09` expire at the 4pm New
 * York close, not at midnight UTC at the start of that date. Pricing a live
 * Friday contract to midnight silently removes most of its final session of
 * time value. The offset is derived through `Intl` so EST/EDT transitions do
 * not need a hard-coded daylight-saving table.
 */
export function listedExpiryInstant(date: string) {
  const day = date.slice(0, 10);
  const guess = Date.parse(`${day}T20:00:00Z`);
  if (!Number.isFinite(guess)) return NaN;
  return guess + (16 - newYorkHour(guess)) * 3_600_000;
}

/**
 * Time to expiry for model valuation.
 *
 * The replay deliberately uses its stored session calendar unchanged. A live
 * wall-clock book instead values a date-only listed option through its New
 * York close. This is kept beside the live-market switch so every product
 * sharing `orderGreeks` sees one clock convention.
 */
export function modelDays(from: string, expiry: string) {
  const start = Date.parse(from);
  const end =
    live && instant(from) && !instant(expiry)
      ? listedExpiryInstant(expiry)
      : Date.parse(expiry);
  return (end - start) / 86_400_000;
}

/** The committed close of one underlying at one observation. */
export function mark(symbol: string, date: string) {
  if (live) {
    const price = instant(date) ? live.spot(symbol) : live.close(symbol, date);
    if (price == null)
      throw Error(
        instant(date)
          ? `No live price for ${symbol} yet. Try again in a moment.`
          : `The ${symbol} close for ${date} is not final yet.`,
      );
    return price;
  }
  return storedMark(symbol, date);
}

/**
 * A close from the stored replay, whatever market is running. The landing
 * page's worked examples are fixed figures on the 2025 file; routed through
 * `mark` they would ask the live market for a 2025 close it never has.
 */
export function storedMark(symbol: string, date: string) {
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
  if (live) return live.expiries(date);
  return storedExpiries(date);
}

/** Session dates after `date` in the stored replay. */
export const storedExpiries = (date: string) =>
  marketRows.filter((r) => r.date > date).map((r) => r.date);

export function shortExpiries(date: string) {
  if (live) return [];
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

/**
 * The expiries a snapshot offers, for the browser.
 *
 * The server sends its own calendar with every snapshot — the replay's
 * stored sessions, or the live market's upcoming Fridays — so a view reads
 * the dates from there rather than from a price file it may not be on.
 */
export function offeredExpiries(market: { dates: string[] }, date: string) {
  const today = date.slice(0, 10);
  return market.dates.filter((d) => !d.includes('T') && d > today);
}
