import { registry } from '../../lib/preipo/registry';
import {
  INSTRUMENTS,
  SPONSOR_SEEDS,
  type Instrument,
  type Kind,
} from './feeds';
import {
  CoinbaseSource,
  MassiveStocksSource,
  PythSource,
  type Observation,
  type Source,
  type SourceHealth,
} from './sources';
import { YahooSource } from './yahoo';

/**
 * The live mark engine.
 *
 * A source priority chain, one number. A configured Massive stream applies
 * NBBO updates as they arrive; Pyth and Coinbase remain resilient polling
 * sources. Anything without a fresh observation is walked forward by a
 * geometric Brownian motion seeded from the last real mark it had. No feed
 * exists for a sponsor token, so without the walk the simulated maker would
 * be frozen most of the time.
 *
 * The distinction is never hidden. Every mark carries the source that
 * produced it and the time of the last real observation, and the UI is
 * required to show both. A simulated tick presented as a market price
 * is the one thing this file must not do.
 */

const FRESH_MS = 20_000;
const TICK_MS = 1000;
const POLL_MS = 2000;
const YEAR_SECONDS = 365 * 24 * 3600;
const TAPE_LENGTH = 48;

export type MarkSource =
  | 'massive-nbbo'
  | 'massive-delayed-nbbo'
  | 'pyth'
  | 'coinbase'
  | 'yahoo'
  | 'simulated';

export interface Mark {
  symbol: string;
  name: string;
  kind: Kind;
  price: number;
  /** Where the instrument opened the current UTC day. */
  open: number;
  change: number;
  bid: number;
  ask: number;
  /** Whether the displayed bid/ask is an NBBO, one venue's BBO, or a model. */
  quoteKind: 'nbbo' | 'venue-bbo' | 'modelled';
  spreadBps: number;
  vol: number;
  source: MarkSource;
  observedAt: number | null;
  /**
   * The source of the last mark is known, but it has not published within
   * the desk freshness window. A stale official close is useful context; it
   * is not a live quote and must never advance a live chart.
   */
  stale: boolean;
  /** Mock-token supply the maker has minted against this instrument. */
  supply: number;
  /** The lending pool standing behind this instrument. */
  supplied: number;
  borrowed: number;
  utilisation: number;
}

export interface Print {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  at: number;
  /** Whether the print minted or burned mock supply. */
  effect: 'mint' | 'burn';
}

interface State extends Instrument {
  price: number;
  open: number;
  openDay: string;
  lastReal: number | null;
  /** Whether `open` is a real baseline or still the boot seed. */
  openIsReal: boolean;
  realSource: string | null;
  realBid: number | null;
  realAsk: number | null;
  realQuoteKind: Observation['quoteKind'] | null;
  supply: number;
  supplied: number;
  borrowed: number;
  minted: number;
  burned: number;
}

const gaussian = () => {
  // Box-Muller. Math.random() can return exactly 0, whose log is -∞.
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export class MarkEngine {
  private state = new Map<string, State>();
  private tape: Print[] = [];
  private seq = 0;
  private yahoo: YahooSource;
  private sources: Source[];
  private timers: NodeJS.Timeout[] = [];
  private sourceStops: (() => void)[] = [];
  private listeners = new Set<(snapshot: MarkSnapshot) => void>();
  private lastTick = Date.now();
  private started = false;

  constructor(
    now = Date.now(),
    sources?: Source[],
  ) {
    // The keyless Yahoo chart endpoint is a deliberately last-resort
    // listed-equity print. It gives the desk a delayed price when no direct
    // quote service is configured; it never displaces Massive NBBO or a Pyth
    // observation, and its modelled spread remains labelled as such.
    this.yahoo = new YahooSource();
    this.sources = sources ?? [
      new MassiveStocksSource(),
      new PythSource(),
      new CoinbaseSource(),
      this.yahoo,
    ];
    const seed = (i: Instrument, price: number): State => ({
      ...i,
      price,
      open: price,
      openDay: day(now),
      lastReal: null,
      openIsReal: false,
      realSource: null,
      realBid: null,
      realAsk: null,
      realQuoteKind: null,
      // Depth is a dollar figure, so units come from dividing by the
      // mark. Seeding units directly meant a pool's size scaled with
      // the price of its asset, and the desk reported a five-trillion
      // dollar bitcoin market.
      supply: i.depth / 12 / price,
      // Deep enough that one desk's borrow does not move the curve, and
      // starting near the utilisation these markets actually run at
      // rather than at zero.
      supplied: i.depth / price,
      borrowed: (i.depth / price) * (0.42 + Math.random() * 0.24),
      minted: 0,
      burned: 0,
    });
    for (const i of INSTRUMENTS) this.state.set(i.symbol, seed(i, i.seed));
    this.seed = seed;
    // Track every sponsor token from boot. Registering them lazily, on
    // the first request that happened to read the providers, meant a
    // reader who opened the pre-IPO screen first saw no change column
    // and no spread until a later poll — and a restarted server lost
    // them again until someone reloaded that one page.
    for (const a of registry)
      this.ensure(a.symbol, SPONSOR_SEEDS[a.symbol] ?? 250);
  }

  private seed: (i: Instrument, price: number) => State;

  /**
   * Track an instrument the engine did not know about at boot, pegged
   * to a price someone else published.
   *
   * The sponsor tokens are the case this exists for. Their symbols and
   * their marks come from the providers at request time, so hardcoding
   * a guessed symbol here produced a mock token that pegged to nothing.
   * The route that reads the publisher registers the reviewed symbols
   * instead, and re-pegs each one whenever the provider's mark moves
   * more than a per-cent, so the walk stays anchored to a real number
   * without snapping on every poll.
   */
  ensure(symbol: string, anchor: number, vol = 0.9, spreadBps = 45) {
    if (!Number.isFinite(anchor) || anchor <= 0) return;
    const existing = this.state.get(symbol);
    if (!existing) {
      this.state.set(
        symbol,
        this.seed(
          {
            symbol,
            name: symbol,
            kind: 'private',
            vol,
            seed: anchor,
            spreadBps,
            depth: 2_500_000,
          },
          anchor,
        ),
      );
      return;
    }
    if (Math.abs(existing.price - anchor) / anchor > 0.01) {
      existing.price = anchor;
      if (!existing.openIsReal) existing.open = anchor;
    }
  }

  /**
   * Begin ticking. Safe to call when the process has no network: feed
   * resolution simply never completes and every instrument stays on the
   * walk. The timers are unref'd so they can never hold the process
   * open, which is what a test runner needs.
   */
  start() {
    if (this.started) return;
    this.started = true;
    for (const source of this.sources) {
      if (!source.subscribe) continue;
      const stop = source.subscribe([...this.state.values()], (rows) => {
        this.accept(rows);
      });
      this.sourceStops.push(stop);
    }
    void this.poll();
    const every = (ms: number, fn: () => void) => {
      const t = setInterval(fn, ms);
      t.unref?.();
      this.timers.push(t);
    };
    every(TICK_MS, () => this.tick());
    every(POLL_MS, () => void this.poll());
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const stop of this.sourceStops) stop();
    this.sourceStops = [];
    this.started = false;
  }

  /**
   * Ask every enabled source, in order, and take the first real
   * observation for each symbol.
   *
   * A venue that has stopped publishing keeps serving its last update,
   * so the age of the observation decides whether an instrument is
   * live — not the fact that a number came back. That is what makes
   * NVDA fall through to the walk at 4pm ET without anyone noticing a
   * seam.
   */
  private polling = false;
  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const instruments = [...this.state.values()];
      const seen = new Map<string, Observation>();
      const now = Date.now();
      for (const source of this.sources) {
        if (!source.enabled) continue;
        let rows: Observation[] = [];
        try {
          rows = await source.observe(instruments);
        } catch {
          rows = [];
        }
        for (const row of rows) {
          // A stale high-priority snapshot must not suppress a fresh lower
          // priority source. Check age before inserting into the priority map.
          if (now - row.at <= FRESH_MS && !seen.has(row.symbol))
            seen.set(row.symbol, row);
        }
      }
      this.accept([...seen.values()]);
    } finally {
      this.polling = false;
    }
  }

  /** Apply direct stream events and recovered polling observations alike. */
  private accept(rows: Observation[]) {
    const now = Date.now();
    let changed = false;
    for (const row of rows) {
      const s = this.state.get(row.symbol);
      if (!s || now - row.at > FRESH_MS) continue;
      // Recovering a cached event after the streaming source has already
      // delivered a newer one must not move a quote backwards.
      if (s.lastReal && s.realSource === row.source && row.at < s.lastReal)
        continue;
      s.price = row.price;
      s.realBid = row.bid ?? null;
      s.realAsk = row.ask ?? null;
      s.realQuoteKind = row.quoteKind ?? null;
      s.lastReal = row.at;
      s.realSource = row.source;
      // The baseline the change column is measured from has to come
      // from the venue, or at worst from the first real mark. Left on
      // the boot seed it reports a 40% move on a flat day.
      if (row.open) {
        s.open = row.open;
        s.openIsReal = true;
      } else if (!s.openIsReal) {
        s.open = row.price;
        s.openIsReal = true;
      }
      s.openDay = day(now);
      changed = true;
    }
    if (changed) this.broadcast();
  }

  private rollDay(s: State, now: number) {
    const d = day(now);
    if (s.openDay !== d) {
      s.openDay = d;
      s.open = s.price;
      s.openIsReal = false;
    }
  }

  private tick() {
    const now = Date.now();
    const dt = Math.max(0, (now - this.lastTick) / 1000) / YEAR_SECONDS;
    this.lastTick = now;
    for (const s of this.state.values()) {
      this.rollDay(s, now);
      if (s.lastReal && now - s.lastReal < FRESH_MS) continue;
      // Never walk a real stock. Between prints it is worth its last
      // trade, and a random walk would draw moves that did not happen.
      if (s.kind === 'equity' && s.lastReal) continue;
      // A stablecoin is pulled back to its peg rather than allowed to
      // wander; a random walk on USDC would quote a dollar at $0.94.
      if (s.kind === 'stable') {
        s.price += (1 - s.price) * 0.25 + gaussian() * 0.00008;
        continue;
      }
      const drift = -0.5 * s.vol * s.vol * dt;
      const shock = s.vol * Math.sqrt(dt) * gaussian();
      s.price = Math.max(0.0001, s.price * Math.exp(drift + shock));
    }
    this.makeMarket(now);
    this.broadcast();
  }

  /**
   * The maker.
   *
   * Two or three prints a second across the book, each one minting or
   * burning the mock token that stands in for the underlying. The
   * supply is what makes the activity legible: a run of buys visibly
   * mints, a run of sells visibly burns, and the tape and the supply
   * can be checked against each other.
   */
  private makeMarket(now: number) {
    const symbols = [...this.state.keys()];
    const count = 1 + Math.floor(Math.random() * 3);
    for (let n = 0; n < count; n++) {
      const s = this.state.get(
        symbols[Math.floor(Math.random() * symbols.length)],
      )!;
      const side = Math.random() < 0.5 ? 'buy' : 'sell';
      const half = (s.price * s.spreadBps) / 10_000;
      const price = side === 'buy' ? s.price + half : s.price - half;
      // Sizes are lognormal-ish: many small clips, the occasional block.
      // Clip sizes are a dollar notional turned into units, so a print
      // in bitcoin and a print in USDC are comparable trades rather
      // than comparable unit counts.
      const notional = 400 * Math.exp(Math.random() * 3.4);
      const size = Math.round((notional / s.price) * 1e4) / 1e4;
      const effect = side === 'buy' ? 'mint' : 'burn';
      if (effect === 'mint') {
        s.supply += size;
        s.minted += size;
        s.supplied += size;
      } else {
        s.supply = Math.max(0, s.supply - size);
        s.burned += size;
        s.supplied = Math.max(size, s.supplied - size);
      }
      // Borrowing wanders on its own clock, bounded well short of the
      // pool: a market at 100% utilisation cannot be withdrawn from,
      // and a rate curve pinned to its own ceiling shows nothing.
      s.borrowed = Math.min(
        s.supplied * 0.94,
        Math.max(s.supplied * 0.08, s.borrowed * (1 + gaussian() * 0.002)),
      );
      this.tape.unshift({
        id: ++this.seq,
        symbol: s.symbol,
        side,
        size,
        price: Math.round(price * 1e6) / 1e6,
        at: now,
        effect,
      });
    }
    if (this.tape.length > TAPE_LENGTH) this.tape.length = TAPE_LENGTH;
  }

  /** Today's real one-minute prints for a listed equity, if observed. */
  intraday(symbol: string) {
    return this.yahoo.intraday(symbol);
  }

  /** One instrument's current mark, or null if it is not tracked. */
  mark(symbol: string): Mark | null {
    const s = this.state.get(symbol.toUpperCase());
    return s ? this.project(s) : null;
  }

  private project(s: State): Mark {
    // A listed equity may reasonably retain its last official print after
    // the market closes, but it is not "live" forever. Treat every source
    // the same here: provenance is retained below while freshness drives the
    // live badge, venue BBO, and browser-session chart tail.
    const fresh = !!s.lastReal && Date.now() - s.lastReal < FRESH_MS;
    const half = (s.price * s.spreadBps) / 10_000;
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    // A venue's own book beats a modelled spread whenever we have one.
    const hasVenueBook =
      fresh &&
      s.realBid !== null &&
      s.realAsk !== null &&
      (s.realQuoteKind === 'nbbo' || s.realQuoteKind === 'venue-bbo');
    const bid = hasVenueBook ? s.realBid! : s.price - half;
    const ask = hasVenueBook ? s.realAsk! : s.price + half;
    const quoteKind = hasVenueBook
      ? s.realQuoteKind === 'nbbo'
        ? 'nbbo'
        : 'venue-bbo'
      : 'modelled';
    return {
      symbol: s.symbol,
      name: s.name,
      kind: s.kind,
      price: round(s.price),
      open: round(s.open),
      change: s.open ? (s.price - s.open) / s.open : 0,
      bid: round(bid),
      ask: round(ask),
      quoteKind,
      spreadBps: s.spreadBps,
      vol: s.vol,
      // Do not erase the provenance of a stale official mark. Consumers can
      // show "last observed" accurately instead of calling an old Yahoo or
      // NBBO print a simulated value. `stale` is the operative state.
      source: s.lastReal ? this.markSource(s.realSource) : 'simulated',
      observedAt: s.lastReal,
      stale: !fresh,
      supply: round(s.supply),
      supplied: round(s.supplied),
      borrowed: round(s.borrowed),
      utilisation: s.supplied > 0 ? s.borrowed / s.supplied : 0,
    };
  }

  private markSource(source: string | null): MarkSource {
    return source === 'massive-nbbo' ||
      source === 'massive-delayed-nbbo' ||
      source === 'pyth' ||
      source === 'coinbase' ||
      source === 'yahoo'
      ? source
      : 'simulated';
  }

  snapshot() {
    const marks = [...this.state.values()].map((s) => this.project(s));
    return {
      asOf: Date.now(),
      /** True only while at least one provider observation is fresh. */
      connected: marks.some(
        (mark) =>
          !mark.stale &&
          mark.source !== 'simulated' &&
          mark.source !== 'yahoo' &&
          mark.source !== 'massive-delayed-nbbo',
      ),
      sources: this.sources.map((x): SourceHealth =>
        x.health?.() ?? {
          name: x.name,
          enabled: x.enabled,
          state: x.enabled ? 'live' : 'disabled',
          detail: x.enabled ? 'Polling source enabled' : 'Polling source disabled',
        },
      ),
      marks,
      tape: this.tape.slice(0, 24),
      minted: [...this.state.values()].reduce((t, s) => t + s.minted, 0),
      burned: [...this.state.values()].reduce((t, s) => t + s.burned, 0),
    };
  }

  /** Subscribe to source/tick updates for the same-origin SSE endpoint. */
  subscribe(listener: (snapshot: MarkSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast() {
    if (!this.listeners.size) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export type MarkSnapshot = ReturnType<MarkEngine['snapshot']>;
