import type { Instrument } from './feeds';

/**
 * Where a real mark can come from.
 *
 * Two adapters behind one interface, tried in order. Neither is allowed
 * to be load-bearing: every request has a timeout, every failure
 * becomes an empty result, and a source that answers 401 or keeps
 * failing switches itself off rather than retrying forever against a
 * wall. Whatever they do not cover, the engine walks.
 *
 * Pyth is first because it is the only one of the two that publishes
 * equities, which is what a desk written on NVDA actually needs. Its
 * price endpoint now wants an API key even though its metadata
 * endpoint is still open, so without PYTH_API_KEY set it resolves feed
 * ids, gets a 401 on the first poll, and stands down. Coinbase needs
 * no key and covers the crypto collateral, so out of the box the
 * blue-chip side of the desk is genuinely live and the equity side is
 * an explicitly labelled simulation.
 */

const TIMEOUT = 4000;

export interface Observation {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  /** The venue's own 24h open, when it publishes one. */
  open?: number;
  /** When the venue published it, in ms. */
  at: number;
  source: string;
}

export interface Source {
  readonly name: string;
  readonly enabled: boolean;
  observe(instruments: Instrument[]): Promise<Observation[]>;
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
interface UpdateRow {
  id: string;
  price?: { price: string; conf: string; expo: number; publish_time: number };
}

export class PythSource implements Source {
  readonly name = 'pyth';
  enabled = true;
  private host = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';
  private key = process.env.PYTH_API_KEY || '';
  private ids = new Map<string, string>();
  private resolved = false;

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
    for (const i of instruments) {
      if (!i.pyth) continue;
      const tail = i.pyth.split('/')[0].split('.').pop() || '';
      const res = await getJson<FeedRow[]>(
        `${this.host}/v2/price_feeds?query=${encodeURIComponent(tail)}`,
        this.headers,
      );
      const hit = Array.isArray(res.body)
        ? res.body.find((r) => r.attributes?.symbol === i.pyth)
        : null;
      if (hit) this.ids.set(hit.id.replace(/^0x/, ''), i.symbol);
    }
  }

  async observe(instruments: Instrument[]): Promise<Observation[]> {
    if (!this.enabled) return [];
    if (!this.resolved) await this.resolve(instruments);
    if (!this.ids.size) return [];
    const query = [...this.ids.keys()]
      .map((id) => `ids%5B%5D=${id}`)
      .join('&');
    const res = await getJson<{ parsed?: UpdateRow[] }>(
      `${this.host}/v2/updates/price/latest?${query}&parsed=true`,
      this.headers,
    );
    if (res.status === 401 || res.status === 403) {
      // Standing down rather than hammering an endpoint that has told
      // us we may not read it. Set PYTH_API_KEY to turn this back on.
      this.enabled = false;
      return [];
    }
    if (!res.body?.parsed) return [];
    const out: Observation[] = [];
    for (const row of res.body.parsed) {
      const symbol = this.ids.get(row.id.replace(/^0x/, ''));
      if (!symbol || !row.price) continue;
      const scale = 10 ** row.price.expo;
      const price = Number(row.price.price) * scale;
      const conf = Number(row.price.conf) * scale;
      if (!Number.isFinite(price) || price <= 0) continue;
      out.push({
        symbol,
        price,
        bid: price - conf,
        ask: price + conf,
        at: row.price.publish_time * 1000,
        source: this.name,
      });
    }
    return out;
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
  /** 24h opens, refreshed far less often than the tick. */
  private opens = new Map<string, number>();
  private opensAt = 0;

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
        };
      }),
    );
    const out = rows.filter((r): r is Observation => !!r);
    // Ten consecutive empty polls means the venue is unreachable from
    // wherever this is deployed, not that it is briefly down.
    this.failures = out.length ? 0 : this.failures + 1;
    if (this.failures >= 10) this.enabled = false;
    return out;
  }
}
