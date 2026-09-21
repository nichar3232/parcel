import type { TokenizedEquityAsset, TokenizedEquityQuote } from './types';

const API = 'https://api.superstate.com';
const CATALOG_TTL_MS = 15 * 60_000;
const QUOTE_TTL_MS = 5_000;
const FAILURE_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_QUOTES = 6;

interface RawDeployment {
  type?: unknown;
  token_address?: unknown;
}
interface RawAsset {
  instrument_id?: unknown;
  instrument_symbol?: unknown;
  instrument_domain?: unknown;
  instrument_name?: unknown;
  nickname?: unknown;
  logo?: unknown;
  description?: unknown;
  deploy_status_by_chain?: { by_chain?: Record<string, RawDeployment> };
}
interface RawPrice {
  price?: unknown;
  timestamp?: unknown;
}
interface CachedQuote extends TokenizedEquityQuote {
  refreshAt: number;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function inBatches<T>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) await work(values[next++]);
    }),
  );
}

/** Public Opening Bell registry and issuer price feed. */
export class SuperstateService {
  private catalogCache: { assets: TokenizedEquityAsset[]; at: number } | null =
    null;
  private catalogRefresh: Promise<TokenizedEquityAsset[]> | null = null;
  private quoteCache = new Map<string, CachedQuote>();
  private quoteRefresh = new Map<string, Promise<void>>();

  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly api = process.env.SUPERSTATE_API_URL || API,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(
      `${this.api.replace(/\/$/, '')}${path}`,
      {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok)
      throw Error(`Superstate responded with ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }

  private async refreshCatalog() {
    const response = await this.get<Record<string, RawAsset>>('/v1/assets');
    const assets = Object.values(response)
      .flatMap((asset): TokenizedEquityAsset[] => {
        if (asset.instrument_domain !== 'Equities') return [];
        const symbol = text(asset.instrument_symbol);
        const mint = text(
          asset.deploy_status_by_chain?.by_chain?.['900']?.token_address,
        );
        // Superstate's public assets endpoint uses chain id 900 for its
        // Solana deployment. Verify completion rather than trusting a
        // pre-announced or failed deployment record.
        const status = asset.deploy_status_by_chain?.by_chain?.['900']?.type;
        if (!symbol || !mint || status !== 'Completed') return [];
        const name =
          text(asset.nickname) ?? text(asset.instrument_name) ?? symbol;
        return [
          {
            id: `superstate:${symbol}`,
            provider: 'superstate',
            providerName: 'Opening Bell',
            symbol,
            name,
            underlyingSymbol: symbol,
            underlyingType: 'Equity',
            logo: text(asset.logo),
            description: text(asset.description),
            mint,
            isTradingHalted: false,
            marketOpen: null,
            nextChangeAt: null,
          },
        ];
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    this.catalogCache = { assets, at: this.now() };
    return assets;
  }

  async catalog() {
    if (this.catalogCache && this.now() - this.catalogCache.at < CATALOG_TTL_MS)
      return this.catalogCache.assets;
    if (!this.catalogRefresh)
      this.catalogRefresh = this.refreshCatalog().finally(() => {
        this.catalogRefresh = null;
      });
    try {
      return await this.catalogRefresh;
    } catch (error) {
      if (this.catalogCache) return this.catalogCache.assets;
      throw error;
    }
  }

  private refreshQuote(asset: TokenizedEquityAsset) {
    const current = this.quoteRefresh.get(asset.id);
    if (current) return current;
    const run = this.get<RawPrice>(
      `/v1/price/${encodeURIComponent(asset.symbol)}`,
    )
      .then((response) => {
        const quote = number(response.price);
        const sourceTime = text(response.timestamp);
        const parsed = sourceTime ? Date.parse(sourceTime) : NaN;
        const observedAt = Number.isFinite(parsed) ? parsed : this.now();
        this.quoteCache.set(asset.id, {
          id: asset.id,
          quote,
          observedAt,
          state: quote === null ? 'unavailable' : 'live',
          provider: 'superstate',
          refreshAt: this.now() + QUOTE_TTL_MS,
        });
      })
      .catch(() => {
        this.quoteCache.set(asset.id, {
          id: asset.id,
          quote: null,
          observedAt: null,
          state: 'unavailable',
          provider: 'superstate',
          refreshAt: this.now() + FAILURE_BACKOFF_MS,
        });
      })
      .finally(() => this.quoteRefresh.delete(asset.id));
    this.quoteRefresh.set(asset.id, run);
    return run;
  }

  async quotes(input: readonly string[]): Promise<TokenizedEquityQuote[]> {
    const assets = await this.catalog();
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const ids = [...new Set(input)].filter((id) => byId.has(id));
    const now = this.now();
    const refresh = ids.filter((id) => {
      const quote = this.quoteCache.get(id);
      return !quote || now >= quote.refreshAt;
    });
    void inBatches(refresh, MAX_CONCURRENT_QUOTES, async (id) => {
      await this.refreshQuote(byId.get(id)!);
    });
    return ids.map((id) => {
      const quote = this.quoteCache.get(id);
      if (quote) {
        const { refreshAt: _refreshAt, ...publicQuote } = quote;
        return publicQuote;
      }
      return {
        id,
        quote: null,
        observedAt: null,
        state: 'pending' as const,
        provider: 'superstate' as const,
      };
    });
  }
}
