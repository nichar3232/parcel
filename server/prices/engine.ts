import { INSTRUMENTS, PRIVATE_SEEDS, type Instrument, type Kind } from './feeds';
import {
  CoinbaseSource,
  PythSource,
  type Observation,
  type Source,
} from './sources';

/**
 * The live mark engine.
 *
 * Two sources, one number. Pyth is polled for every instrument that has
 * a feed; anything without a fresh observation is walked forward by a
 * geometric Brownian motion seeded from the last real mark it had. The
 * equity feeds stop publishing when the cash market closes and no feed
 * exists for a sponsor token at all, so without the walk most of the
 * desk would be frozen most of the time.
 *
 * The distinction is never hidden. Every mark carries the source that
 * produced it and the time of the last real observation, and the UI is
 * required to show both. A simulated tick presented as a market price
 * is the one thing this file must not do.
 */

const FRESH_MS = 20_000;
const TICK_MS = 1000;
const POLL_MS = 3000;
const YEAR_SECONDS = 365 * 24 * 3600;
const TAPE_LENGTH = 48;

export type MarkSource = 'pyth' | 'coinbase' | 'simulated';

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
  spreadBps: number;
  vol: number;
  source: MarkSource;
  observedAt: number | null;
  /** Mock-token supply the maker has minted against this instrument. */
  supply: number;
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
  supply: number;
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
  private sources: Source[] = [new PythSource(), new CoinbaseSource()];
  private timers: NodeJS.Timeout[] = [];
  private lastTick = Date.now();
  private started = false;

  constructor(now = Date.now()) {
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
      supply: Math.round(price * 40),
      minted: 0,
      burned: 0,
    });
    for (const i of INSTRUMENTS) this.state.set(i.symbol, seed(i, i.seed));
    // The sponsor tokens are instruments too; they simply have no feed.
    for (const [symbol, price] of Object.entries(PRIVATE_SEEDS))
      this.state.set(
        symbol,
        seed(
          {
            symbol,
            name: symbol.replace(/^T-/, ''),
            kind: 'private',
            vol: 0.9,
            seed: price,
            spreadBps: 45,
          },
          price,
        ),
      );
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
      for (const source of this.sources) {
        if (!source.enabled) continue;
        let rows: Observation[] = [];
        try {
          rows = await source.observe(instruments);
        } catch {
          rows = [];
        }
        for (const row of rows) if (!seen.has(row.symbol)) seen.set(row.symbol, row);
      }
      const now = Date.now();
      for (const [symbol, row] of seen) {
        const s = this.state.get(symbol);
        if (!s || now - row.at > FRESH_MS) continue;
        s.price = row.price;
        s.realBid = row.bid ?? null;
        s.realAsk = row.ask ?? null;
        s.lastReal = now;
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
      }
    } finally {
      this.polling = false;
    }
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
      const size =
        Math.round(
          Math.exp(Math.random() * 3.4) * (s.price > 1000 ? 0.01 : 1) * 1e4,
        ) / 1e4;
      const effect = side === 'buy' ? 'mint' : 'burn';
      if (effect === 'mint') {
        s.supply += size;
        s.minted += size;
      } else {
        s.supply = Math.max(0, s.supply - size);
        s.burned += size;
      }
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

  /** One instrument's current mark, or null if it is not tracked. */
  mark(symbol: string): Mark | null {
    const s = this.state.get(symbol.toUpperCase());
    return s ? this.project(s) : null;
  }

  private project(s: State): Mark {
    const fresh = !!s.lastReal && Date.now() - s.lastReal < FRESH_MS;
    const half = (s.price * s.spreadBps) / 10_000;
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    // A venue's own book beats a modelled spread whenever we have one.
    const bid = fresh && s.realBid ? s.realBid : s.price - half;
    const ask = fresh && s.realAsk ? s.realAsk : s.price + half;
    return {
      symbol: s.symbol,
      name: s.name,
      kind: s.kind,
      price: round(s.price),
      open: round(s.open),
      change: s.open ? (s.price - s.open) / s.open : 0,
      bid: round(bid),
      ask: round(ask),
      spreadBps: s.spreadBps,
      vol: s.vol,
      source: fresh ? ((s.realSource as MarkSource) ?? 'simulated') : 'simulated',
      observedAt: s.lastReal,
      supply: round(s.supply),
    };
  }

  snapshot() {
    const marks = [...this.state.values()].map((s) => this.project(s));
    return {
      asOf: Date.now(),
      /** True once any feed has ever answered, so the UI can say why. */
      connected: [...this.state.values()].some((s) => s.lastReal !== null),
      sources: this.sources.map((x) => ({ name: x.name, enabled: x.enabled })),
      marks,
      tape: this.tape.slice(0, 24),
      minted: [...this.state.values()].reduce((t, s) => t + s.minted, 0),
      burned: [...this.state.values()].reduce((t, s) => t + s.burned, 0),
    };
  }
}

export type MarkSnapshot = ReturnType<MarkEngine['snapshot']>;
