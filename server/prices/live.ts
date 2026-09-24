import type { LiveMarket } from '../../lib/parcel/market';
import { UNDERLYINGS } from '../../lib/parcel/universe';
import type { Store } from '../db/store';
import type { MarkEngine } from './engine';

/**
 * The live market the vault prices and settles against.
 *
 * Spot is the engine's current mark. A settlement price is the close on
 * the expiry date, recorded once and kept: a listed stock's from the
 * venue's daily bar, a private-company token's from the engine's mark at
 * the first read after the close. Once written, a close never changes,
 * so a book settles to the same numbers however many times it is read
 * and however often the process restarts.
 *
 * Expiries are Fridays at the 4pm New York close — the next eight weeks,
 * then the third Friday of each of the following months out to six.
 */

const TIMEOUT = 5000;
const HOST = process.env.YAHOO_CHART_URL || 'https://query1.finance.yahoo.com';

const nyParts = (at: number) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
  };
};

/** 4pm in New York on a calendar date, as an instant. */
export function closeInstant(date: string) {
  const guess = Date.parse(`${date}T20:00:00Z`);
  return guess + (16 - nyParts(guess).hour) * 3_600_000;
}

/** The dates a contract can be written to, after `now`. */
export function fridayExpiries(now: string | number) {
  const at = typeof now === 'number' ? now : Date.parse(now);
  const today = nyParts(at).date;
  const out = new Set<string>();
  const cursor = new Date(`${today}T12:00:00Z`);
  // Weeklies: the next eight Fridays after today.
  while (out.size < 8) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() === 5) out.add(cursor.toISOString().slice(0, 10));
  }
  // Monthlies: third Fridays, out to six months.
  const start = new Date(`${today}T12:00:00Z`);
  for (let m = 0; m <= 6; m++) {
    const first = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1, 12),
    );
    const offset = (5 - first.getUTCDay() + 7) % 7;
    const third = new Date(first);
    third.setUTCDate(1 + offset + 14);
    const d = third.toISOString().slice(0, 10);
    if (d > today) out.add(d);
  }
  return [...out].sort();
}

export class LiveMarketService implements LiveMarket {
  private closes = new Map<string, number>();
  private daily = new Map<string, Map<string, number>>();
  private timer: NodeJS.Timeout | undefined;
  private equities = UNDERLYINGS.filter((u) => u.provider === 'equity').map(
    (u) => u.symbol,
  );

  constructor(
    private engine: MarkEngine,
    private store: Store,
    private now = Date.now,
  ) {
    this.store.db.exec(
      `CREATE TABLE IF NOT EXISTS parcel_closes(
        symbol TEXT NOT NULL,
        date TEXT NOT NULL,
        price REAL NOT NULL,
        source TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY(symbol, date)
      )`,
    );
    const rows = this.store.db
      .prepare('SELECT symbol,date,price FROM parcel_closes')
      .all() as { symbol: string; date: string; price: number }[];
    for (const r of rows) this.closes.set(`${r.symbol}|${r.date}`, r.price);
  }

  start() {
    void this.refreshDaily();
    this.timer = setInterval(() => void this.refreshDaily(), 10 * 60_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Resolves once every listed stock has a real mark, or after `ms`. */
  async ready(ms = 10_000) {
    const until = this.now() + ms;
    while (this.now() < until) {
      if (this.equities.every((s) => this.spot(s) != null)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  spot(symbol: string) {
    const m = this.engine.mark(symbol);
    if (!m) return null;
    // A listed stock is priced only once the venue has answered; the
    // engine's boot seed is not a price anyone traded at.
    if (m.kind === 'equity' && m.source === 'simulated') return null;
    return m.price;
  }

  quote(symbol: string) {
    const m = this.engine.mark(symbol);
    // A stock transfer is the one sandbox action whose cash amount is based
    // on a quoted two-sided market. Do not silently substitute Yahoo's delayed
    // last, an oracle mark, an old NBBO, or the engine's maker spread. Those
    // remain useful *display* marks and can price a clearly-labelled option
    // model indication, but are not executable stock liquidity.
    if (
      !m ||
      m.stale ||
      m.kind !== 'equity' ||
      m.source !== 'massive-nbbo' ||
      m.quoteKind !== 'nbbo' ||
      !Number.isFinite(m.bid) ||
      !Number.isFinite(m.ask) ||
      m.bid <= 0 ||
      m.ask <= m.bid ||
      !Number.isFinite(m.bidSize) ||
      !Number.isFinite(m.askSize) ||
      m.bidSize! <= 0 ||
      m.askSize! <= 0
    )
      return null;
    return {
      bid: m.bid,
      ask: m.ask,
      bidSize: m.bidSize!,
      askSize: m.askSize!,
    };
  }

  close(symbol: string, date: string) {
    const key = `${symbol}|${date}`;
    const recorded = this.closes.get(key);
    if (recorded != null) return recorded;
    // Five minutes after the bell, so the venue has printed the close.
    if (this.now() < closeInstant(date) + 5 * 60_000) return null;
    let price: number | null = null,
      source = '';
    if (this.equities.includes(symbol)) {
      const bars = this.daily.get(symbol);
      if (!bars) {
        void this.refreshDaily();
        return null;
      }
      price = bars.get(date) ?? null;
      if (price == null) {
        // No bar on the date itself: a market holiday. Once the venue
        // has printed a later session, the last close on or before the
        // date is the settlement price.
        const dates = [...bars.keys()].sort();
        if (dates.some((d) => d > date)) {
          const before = dates.filter((d) => d < date).at(-1);
          price = before ? bars.get(before)! : null;
        } else void this.refreshDaily();
      }
      source = 'yahoo-daily-close';
    } else {
      price = this.spot(symbol);
      source = 'engine-mark-at-close';
    }
    if (price == null || !Number.isFinite(price) || price <= 0) return null;
    price = Math.round(price * 1e6) / 1e6;
    this.store.db
      .prepare('INSERT OR IGNORE INTO parcel_closes VALUES(?,?,?,?,?)')
      .run(symbol, date, price, source, this.now());
    this.closes.set(key, price);
    return price;
  }

  expiries(now: string) {
    return fridayExpiries(now);
  }

  private refreshing = false;
  private async refreshDaily() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await Promise.all(
        this.equities.map(async (symbol) => {
          try {
            const res = await fetch(
              `${HOST}/v8/finance/chart/${symbol}?interval=1d&range=1y`,
              {
                signal: AbortSignal.timeout(TIMEOUT),
                headers: {
                  accept: 'application/json',
                  'user-agent': 'Mozilla/5.0',
                },
              },
            );
            if (!res.ok) return;
            const body = (await res.json()) as {
              chart?: {
                result?: {
                  timestamp?: number[];
                  indicators?: { quote?: { close?: (number | null)[] }[] };
                }[];
              };
            };
            const r = body.chart?.result?.[0];
            const closes = r?.indicators?.quote?.[0]?.close ?? [];
            const bars = new Map<string, number>();
            const today = nyParts(this.now()).date;
            (r?.timestamp ?? []).forEach((ts, i) => {
              const c = closes[i];
              const d = nyParts(ts * 1000).date;
              // Today's bar moves until the close; it is not a close yet.
              if (
                c != null &&
                c > 0 &&
                (d < today || this.now() >= closeInstant(d) + 5 * 60_000)
              )
                bars.set(d, Math.round(c * 1e6) / 1e6);
            });
            if (bars.size) this.daily.set(symbol, bars);
          } catch {
            /* the next refresh tries again; nothing settles meanwhile */
          }
        }),
      );
    } finally {
      this.refreshing = false;
    }
  }

  /** Recent daily closes for a listed stock, oldest first. */
  history(symbol: string) {
    const bars = this.daily.get(symbol);
    return bars
      ? [...bars]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, close]) => ({ date, close }))
      : [];
  }
}
