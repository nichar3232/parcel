import type { Instrument } from './feeds';

/**
 * Where a real mark can come from.
 *
 * Real-time and REST adapters behind one interface, tried in order. Neither is allowed
 * to be load-bearing: every request has a timeout, every failure
 * becomes an empty result, and a source that answers 401 or keeps
 * failing switches itself off rather than retrying forever against a
 * wall. Whatever they do not cover, the engine walks.
 *
 * Massive's stock stream is first when it is configured because it carries
 * consolidated NBBO quotes. Pyth is an oracle mark — its confidence interval
 * is explicitly not represented as a bid/ask. Coinbase remains a venue BBO
 * for crypto collateral. Issuer-priced Solana equities are handled by the
 * separate issuer integrations; they are never silently passed into a
 * simulated fallback.
 */

const TIMEOUT = 4000;
// Must stay aligned with MarkEngine's freshness horizon. A new trade can keep
// a mark current, but it cannot make an older displayed book current again.
const BOOK_FRESH_MS = 20_000;
const BOOK_MAX_FUTURE_SKEW_MS = 5_000;

export interface Observation {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  /** Displayed shares at the bid and ask, when the venue publishes depth. */
  bidSize?: number;
  askSize?: number;
  /** The venue's own 24h open, when it publishes one. */
  open?: number;
  /** When the venue published it, in ms. */
  at: number;
  source: string;
  /** What the optional bid and ask actually represent. */
  quoteKind?: 'nbbo' | 'venue-bbo' | 'oracle';
}

export interface SourceHealth {
  name: string;
  enabled: boolean;
  state: 'disabled' | 'connecting' | 'live' | 'degraded';
  detail: string;
}

export interface Source {
  readonly name: string;
  readonly enabled: boolean;
  observe(instruments: Instrument[]): Promise<Observation[]>;
  /**
   * Sources that support a persistent connection call `receive` whenever a
   * new event arrives. The engine still polls their cache as a recovery path.
   */
  subscribe?(
    instruments: Instrument[],
    receive: (observations: Observation[]) => void,
  ): () => void;
  health?(): SourceHealth;
}

async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: T | null }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: 'application/json', ...headers },
    });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/* ---------------------------------------------------------------- */

interface FeedRow {
  id: string;
  attributes?: { symbol?: string };
}

/* ---------------------------------------------------------------- */

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

interface MassiveEvent {
  ev?: unknown;
  sym?: unknown;
  p?: unknown;
  bp?: unknown;
  ap?: unknown;
  bs?: unknown;
  as?: unknown;
  t?: unknown;
}

interface MassiveBook {
  bid: number;
  ask: number;
  bidSize: number | null;
  askSize: number | null;
  at: number;
}

const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

const epochMs = (value: unknown, fallback: number) => {
  const at = finite(value);
  if (at === null || at <= 0) return fallback;
  // The provider's stock websocket uses milliseconds. The guard keeps a
  // future schema using nanoseconds from making every event look stale.
  if (at > 1e16) return Math.floor(at / 1e6);
  if (at > 1e13) return Math.floor(at / 1e3);
  if (at < 1e11) return Math.floor(at * 1000);
  return Math.floor(at);
};

const socketFactory: SocketFactory = (url) => {
  if (!globalThis.WebSocket)
    throw Error('This Node runtime does not provide a WebSocket client.');
  return new globalThis.WebSocket(url) as unknown as SocketLike;
};

/**
 * A single-server subscription to consolidated listed-equity quotes.
 *
 * Browser clients never receive the market-data credential. The source keeps
 * one upstream connection, applies every NBBO/trade event immediately in the
 * server's mark engine, and exposes a read-only same-origin stream to the
 * desk. Set MASSIVE_STOCKS_FEED=delayed only for explicitly delayed views;
 * the source will say so in its payload rather than calling delayed data live.
 */
export class MassiveStocksSource implements Source {
  readonly name: string;
  enabled: boolean;
  private readonly host: string;
  private readonly key: string;
  private readonly createSocket: SocketFactory;
  private socket: SocketLike | null = null;
  private books = new Map<string, MassiveBook>();
  private trades = new Map<string, { price: number; at: number }>();
  private latest = new Map<string, Observation>();
  private symbols: string[] = [];
  private receive: ((observations: Observation[]) => void) | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private retryMs = 1000;
  private stopped = false;
  private state: SourceHealth['state'];
  private detail: string;

  constructor(
    env: Record<string, string | undefined> = process.env,
    createSocket: SocketFactory = socketFactory,
  ) {
    this.key = env.MASSIVE_STOCKS_API_KEY || '';
    const feed = env.MASSIVE_STOCKS_FEED === 'delayed' ? 'delayed' : 'realtime';
    this.name = feed === 'delayed' ? 'massive-delayed-nbbo' : 'massive-nbbo';
    this.host =
      env.MASSIVE_STOCKS_WS_URL ||
      (feed === 'delayed'
        ? 'wss://delayed.massive.com/stocks'
        : 'wss://socket.massive.com/stocks');
    this.createSocket = createSocket;
    this.enabled = !!this.key;
    this.state = this.enabled ? 'connecting' : 'disabled';
    this.detail = this.enabled
      ? `${feed === 'delayed' ? 'Delayed' : 'Real-time'} NBBO awaiting connection`
      : 'MASSIVE_STOCKS_API_KEY is not configured';
  }

  health(): SourceHealth {
    return {
      name: this.name,
      enabled: this.enabled,
      state: this.state,
      detail: this.detail,
    };
  }

  async observe(_instruments: Instrument[]): Promise<Observation[]> {
    return [...this.latest.values()];
  }

  subscribe(
    instruments: Instrument[],
    receive: (observations: Observation[]) => void,
  ) {
    if (!this.enabled) return () => undefined;
    this.stopped = false;
    this.receive = receive;
    this.symbols = instruments
      .filter((instrument) => instrument.kind === 'equity')
      .map((instrument) => instrument.symbol)
      .sort();
    this.connect();
    return () => {
      this.stopped = true;
      this.receive = null;
      if (this.reconnect) clearTimeout(this.reconnect);
      this.reconnect = null;
      this.socket?.close();
      this.socket = null;
    };
  }

  private connect() {
    if (this.stopped || !this.enabled || this.socket || !this.symbols.length)
      return;
    this.state = 'connecting';
    this.detail = 'Connecting to the listed-equity NBBO stream';
    try {
      const socket = this.createSocket(this.host);
      this.socket = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ action: 'auth', params: this.key }));
      };
      socket.onmessage = (event) => this.onMessage(event.data);
      socket.onerror = () => {
        this.detail = 'Listed-equity NBBO stream errored; reconnecting';
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (!this.stopped && this.enabled) this.scheduleReconnect();
      };
    } catch {
      this.socket = null;
      this.detail = 'Could not open the listed-equity NBBO stream; reconnecting';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnect || this.stopped || !this.enabled) return;
    this.state = 'degraded';
    const after = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      this.connect();
    }, after);
    this.reconnect.unref?.();
  }

  private onMessage(data: unknown) {
    if (typeof data !== 'string') return;
    let events: MassiveEvent[];
    try {
      const parsed = JSON.parse(data) as unknown;
      events = Array.isArray(parsed) ? (parsed as MassiveEvent[]) : [parsed as MassiveEvent];
    } catch {
      return;
    }
    for (const event of events) {
      if (event.ev === 'status') {
        const status = text((event as Record<string, unknown>).status);
        const message = text((event as Record<string, unknown>).message);
        if (status === 'auth_success') {
          this.retryMs = 1000;
          this.state = 'live';
          this.detail = 'Authenticated listed-equity NBBO stream';
          const params = this.symbols.flatMap((symbol) => [
            `Q.${symbol}`,
            `T.${symbol}`,
          ]).join(',');
          this.socket?.send(JSON.stringify({ action: 'subscribe', params }));
        } else if (/auth|not authorized|denied/i.test(`${status} ${message}`)) {
          // An invalid credential is not a transient transport error. Stop
          // retrying it until the server is restarted with a corrected key.
          this.enabled = false;
          this.state = 'disabled';
          this.detail = 'Listed-equity NBBO authentication was rejected';
          this.socket?.close();
        }
        continue;
      }
      if (event.ev !== 'Q' && event.ev !== 'T') continue;
      const symbol = typeof event.sym === 'string' ? event.sym : '';
      if (!this.symbols.includes(symbol)) continue;
      const at = epochMs(event.t, Date.now());
      if (event.ev === 'Q') {
        const bid = finite(event.bp);
        const ask = finite(event.ap);
        if (bid === null || ask === null || bid <= 0 || ask <= bid) continue;
        const bidSize = finite(event.bs);
        const askSize = finite(event.as);
        this.books.set(symbol, {
          bid,
          ask,
          // A malformed or omitted depth is represented as unavailable, not
          // silently coerced to one share. The execution boundary decides
          // whether a quote without disclosed size is usable.
          bidSize: bidSize !== null && bidSize > 0 ? bidSize : null,
          askSize: askSize !== null && askSize > 0 ? askSize : null,
          at,
        });
      } else {
        const price = finite(event.p);
        if (price === null || price <= 0) continue;
        this.trades.set(symbol, { price, at });
      }
      const next = this.compose(symbol);
      if (!next) continue;
      this.latest.set(symbol, next);
      this.receive?.([next]);
    }
  }

  private compose(symbol: string): Observation | null {
    const book = this.books.get(symbol);
    const trade = this.trades.get(symbol);
    const currentBook =
      book &&
      Date.now() - book.at <= BOOK_FRESH_MS &&
      book.at - Date.now() <= BOOK_MAX_FUTURE_SKEW_MS
        ? book
        : null;
    if (!currentBook && !trade) return null;
    // The mark uses the current NBBO midpoint whenever it exists. Last trade
    // remains the fallback before a book arrives or after its book has aged
    // out; a new trade must never make the old book look fresh.
    const price = currentBook
      ? (currentBook.bid + currentBook.ask) / 2
      : trade!.price;
    return {
      symbol,
      price,
      bid: currentBook?.bid,
      ask: currentBook?.ask,
      ...(currentBook?.bidSize ? { bidSize: currentBook.bidSize } : {}),
      ...(currentBook?.askSize ? { askSize: currentBook.askSize } : {}),
      at: currentBook?.at ?? trade!.at,
      source: this.name,
      quoteKind: currentBook ? 'nbbo' : undefined,
    };
  }
}

/* ---------------------------------------------------------------- */
interface UpdateRow {
  id: string;
  price?: { price: string; conf: string; expo: number; publish_time: number };
}

export class PythSource implements Source {
  readonly name = 'pyth';
  enabled: boolean;
  private host =
    process.env.PYTH_HERMES_URL || 'https://pyth.dourolabs.app/hermes';
  private key = process.env.PYTH_API_KEY || '';
  private ids = new Map<string, string>();
  private latest = new Map<string, Observation>();
  private resolved = false;
  private streamAbort: AbortController | null = null;
  private streamRetry: NodeJS.Timeout | null = null;
  private streamStopped = false;
  private streaming = false;
  private state: SourceHealth['state'];
  private detail: string;

  constructor() {
    this.enabled = !!this.key;
    this.state = this.enabled ? 'connecting' : 'disabled';
    this.detail = this.enabled
      ? 'Resolving authenticated Pyth oracle feeds'
      : 'PYTH_API_KEY is not configured';
  }

  health(): SourceHealth {
    return {
      name: this.name,
      enabled: this.enabled,
      state: this.state,
      detail: this.detail,
    };
  }

  private get headers(): Record<string, string> {
    return this.key ? { authorization: `Bearer ${this.key}` } : {};
  }

  /**
   * Resolve each Pyth symbol to its feed id, exactly.
   *
   * The query endpoint matches loosely — asking for NVDA returns
   * NVDAX and an AI/NVDA ratio alongside the equity — so the result is
   * filtered back to an exact symbol match. Accepting a near match
   * quotes the wrong instrument against a real contract, which is the
   * worst failure available here.
   */
  private async resolve(instruments: Instrument[]) {
    this.resolved = true;
    // Metadata reads are independent. Resolving a seven-stock watchlist in
    // parallel prevents one slow lookup from holding every other symbol back,
    // while the exact-symbol filter below still rules out a plausible but
    // incorrect near match.
    await Promise.all(
      instruments
        .filter((i) => i.pyth)
        .map(async (i) => {
          const tail = i.pyth!.split('/')[0].split('.').pop() || '';
          const res = await getJson<FeedRow[]>(
            `${this.host}/v2/price_feeds?query=${encodeURIComponent(tail)}`,
            this.headers,
          );
          const hit = Array.isArray(res.body)
            ? res.body.find((r) => r.attributes?.symbol === i.pyth)
            : null;
          if (hit) this.ids.set(hit.id.replace(/^0x/, ''), i.symbol);
        }),
    );
  }

  /** Convert one Hermes payload into exact configured instruments only. */
  private readings(body: { parsed?: UpdateRow[] }): Observation[] {
    const out: Observation[] = [];
    for (const row of body.parsed ?? []) {
      const symbol = this.ids.get(row.id.replace(/^0x/, ''));
      if (!symbol || !row.price) continue;
      const scale = 10 ** row.price.expo;
      const price = Number(row.price.price) * scale;
      if (!Number.isFinite(price) || price <= 0) continue;
      out.push({
        symbol,
        price,
        at: row.price.publish_time * 1000,
        source: this.name,
        // A confidence interval is a statistical bound, not a bid/ask.
        quoteKind: 'oracle',
      });
    }
    return out;
  }

  private accept(rows: Observation[], receive?: (rows: Observation[]) => void) {
    if (!rows.length) return;
    for (const row of rows) this.latest.set(row.symbol, row);
    this.state = 'live';
    receive?.(rows);
  }

  async observe(instruments: Instrument[]): Promise<Observation[]> {
    if (!this.enabled) return [];
    if (!this.resolved) await this.resolve(instruments);
    if (!this.ids.size) {
      this.state = 'degraded';
      this.detail = 'Pyth oracle could not resolve an exact configured feed';
      return [];
    }
    // A healthy stream owns the current values. Returning its cache keeps the
    // two-second recovery poll from competing with an event-driven feed;
    // MarkEngine still rejects a cache entry once its provider timestamp is
    // older than the freshness window.
    if (this.streaming && this.latest.size)
      return [...this.latest.values()];
    const query = [...this.ids.keys()].map((id) => `ids%5B%5D=${id}`).join('&');
    const res = await getJson<{ parsed?: UpdateRow[] }>(
      `${this.host}/v2/updates/price/latest?${query}&parsed=true`,
      this.headers,
    );
    if (res.status === 401 || res.status === 403) {
      // Standing down rather than hammering an endpoint that has told
      // us we may not read it. Set PYTH_API_KEY to turn this back on.
      this.enabled = false;
      this.state = 'disabled';
      this.detail = 'Pyth oracle authentication was rejected';
      return [];
    }
    if (!res.body?.parsed) {
      this.state = 'degraded';
      this.detail = 'Pyth oracle returned no current observations';
      return [];
    }
    const out = this.readings(res.body);
    this.accept(out);
    this.state = out.length ? 'live' : 'degraded';
    this.detail = out.length
      ? `Pyth oracle ${this.streaming ? 'streaming' : 'polling'} ${out.length} current mark${out.length === 1 ? '' : 's'}`
      : 'Pyth oracle returned no usable current marks';
    return out;
  }

  /**
   * Hermes can stream the same exact price-update payload used by the REST
   * recovery path. Keep one server-side stream and hand each current update
   * straight to the mark engine; browser tabs continue to receive the
   * coalesced same-origin SSE stream. A failed stream falls back to polling
   * and reconnects with bounded backoff rather than inventing intermediate
   * prices.
   */
  subscribe(
    instruments: Instrument[],
    receive: (observations: Observation[]) => void,
  ) {
    if (!this.enabled) return () => undefined;
    this.streamStopped = false;
    let retry = 1000;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        this.streamRetry = setTimeout(() => {
          this.streamRetry = null;
          resolve();
        }, ms);
        this.streamRetry.unref?.();
      });
    const parseChunk = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      try {
        this.accept(this.readings(JSON.parse(data) as { parsed?: UpdateRow[] }), receive);
      } catch {
        // A malformed event is discarded; the stream's next complete event
        // and the REST recovery path remain independent.
      }
    };
    const run = async () => {
      while (!this.streamStopped && this.enabled) {
        try {
          if (!this.resolved) await this.resolve(instruments);
          if (!this.ids.size) throw Error('No exact Pyth feeds resolved.');
          const query = [...this.ids.keys()]
            .map((id) => `ids%5B%5D=${id}`)
            .join('&');
          const controller = new AbortController();
          this.streamAbort = controller;
          const res = await fetch(
            `${this.host}/v2/updates/price/stream?${query}&parsed=true`,
            { headers: this.headers, signal: controller.signal },
          );
          if (res.status === 401 || res.status === 403) {
            this.enabled = false;
            this.state = 'disabled';
            this.detail = 'Pyth oracle authentication was rejected';
            return;
          }
          if (!res.ok || !res.body)
            throw Error(`Pyth stream responded with ${res.status}.`);
          this.streaming = true;
          this.state = 'live';
          this.detail = 'Pyth oracle streaming current price updates';
          retry = 1000;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!this.streamStopped) {
            const next = await reader.read();
            if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? '';
            blocks.forEach(parseChunk);
          }
          reader.releaseLock();
        } catch {
          if (!this.streamStopped && this.enabled) {
            this.state = 'degraded';
            this.detail = 'Pyth oracle stream interrupted; polling and reconnecting';
          }
        } finally {
          this.streaming = false;
          this.streamAbort = null;
        }
        if (!this.streamStopped && this.enabled) {
          await sleep(retry);
          retry = Math.min(retry * 2, 30_000);
        }
      }
    };
    void run();
    return () => {
      this.streamStopped = true;
      this.streamAbort?.abort();
      this.streamAbort = null;
      if (this.streamRetry) clearTimeout(this.streamRetry);
      this.streamRetry = null;
      this.streaming = false;
    };
  }
}

/* ---------------------------------------------------------------- */

interface CoinbaseTicker {
  price?: string;
  bid?: string;
  ask?: string;
  time?: string;
}
interface CoinbaseStats {
  open?: string;
}

export class CoinbaseSource implements Source {
  readonly name = 'coinbase';
  enabled = true;
  private host =
    process.env.COINBASE_API_URL || 'https://api.exchange.coinbase.com';
  private failures = 0;
  private state: SourceHealth['state'] = 'connecting';
  private detail = 'Reading crypto venue BBO';
  /** 24h opens, refreshed far less often than the tick. */
  private opens = new Map<string, number>();
  private opensAt = 0;

  health(): SourceHealth {
    return {
      name: this.name,
      enabled: this.enabled,
      state: this.state,
      detail: this.detail,
    };
  }

  /**
   * The venue's own 24h open, cached for a minute.
   *
   * Without it the change column is measured from whatever this
   * process happened to be holding when it booted, which on a cold
   * start is the seed constant and reads as a 40% move on an
   * unremarkable day.
   */
  private async refreshOpens(wanted: Instrument[]) {
    if (Date.now() - this.opensAt < 60_000) return;
    this.opensAt = Date.now();
    await Promise.all(
      wanted.map(async (i) => {
        const res = await getJson<CoinbaseStats>(
          `${this.host}/products/${i.coinbase}/stats`,
        );
        const open = Number(res.body?.open);
        if (Number.isFinite(open) && open > 0) this.opens.set(i.symbol, open);
      }),
    );
  }

  async observe(instruments: Instrument[]): Promise<Observation[]> {
    if (!this.enabled) return [];
    const wanted = instruments.filter((i) => i.coinbase);
    await this.refreshOpens(wanted);
    const rows = await Promise.all(
      wanted.map(async (i): Promise<Observation | null> => {
        const res = await getJson<CoinbaseTicker>(
          `${this.host}/products/${i.coinbase}/ticker`,
        );
        const price = Number(res.body?.price);
        if (!res.ok || !Number.isFinite(price) || price <= 0) return null;
        return {
          symbol: i.symbol,
          price,
          bid: Number(res.body?.bid) || undefined,
          ask: Number(res.body?.ask) || undefined,
          open: this.opens.get(i.symbol),
          at: res.body?.time ? Date.parse(res.body.time) : Date.now(),
          source: this.name,
          quoteKind: 'venue-bbo',
        };
      }),
    );
    const out = rows.filter((r): r is Observation => !!r);
    // Public venue access can be rate limited or briefly unavailable. Keep
    // polling so a temporary transport failure cannot freeze crypto marks
    // until the process is restarted; credentials are the only condition
    // that should permanently disable a source.
    this.failures = out.length ? 0 : this.failures + 1;
    if (out.length) {
      this.state = 'live';
      this.detail = `Coinbase delivering ${out.length} current venue mark${out.length === 1 ? '' : 's'}`;
    } else {
      this.state = 'degraded';
      this.detail = `Coinbase returned no current venue marks${this.failures > 1 ? ` (${this.failures} consecutive polls)` : ''}`;
    }
    return out;
  }
}
