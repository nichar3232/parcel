/**
 * Read-only xStocks integration.
 *
 * The issuer owns both the Solana deployment registry and the indicative
 * price feed. Keeping this outside MarkEngine is deliberate: MarkEngine has
 * a clearly-labelled simulated fallback for the sandbox tape, whereas an
 * xStock with no current issuer quote must remain unpriced instead of being
 * walked forward or inferred from its traditional ticker.
 */

const NETWORK = 'Solana';
const PAGE_SIZE = 100;
const CATALOG_TTL_MS = 15 * 60_000;
const QUOTE_TTL_MS = 3_000;
const QUOTE_FAILURE_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_QUOTES_PER_REQUEST = 50;
const MAX_CONCURRENT_QUOTES = 6;

export interface XStockAsset {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  underlyingType: 'Equity' | 'ETF' | null;
  logo: string | null;
  description: string | null;
  mint: string;
  isTradingHalted: boolean;
  marketOpen: boolean | null;
  nextChangeAt: string | null;
}

export interface XStockCatalog {
  assets: XStockAsset[];
  refreshedAt: number;
  source: 'xstocks';
}

export interface XStockQuote {
  symbol: string;
  /** The issuer returned no current quote. This is never modelled. */
  quote: number | null;
  /** xStocks price-data does not publish an observation timestamp. */
  observedAt: number | null;
  /** When Parcel received the issuer response. */
  receivedAt: number | null;
  state: 'live' | 'unavailable' | 'pending';
  source: 'xstocks';
}

interface CachedQuote extends XStockQuote {
  /** Internal retry schedule; never returned to the browser as market data. */
  refreshAt: number;
}

interface ApiDeployment {
  address?: unknown;
  network?: unknown;
}
interface ApiNode {
  symbol?: unknown;
  name?: unknown;
  underlyingSymbol?: unknown;
  underlying?: { type?: unknown } | null;
  logo?: unknown;
  description?: unknown;
  isTradingHalted?: unknown;
  trading?: {
    openNow?: unknown;
    nextChangeAt?: unknown;
  } | null;
  deployments?: ApiDeployment[];
}
interface ApiPage {
  nodes?: ApiNode[];
  page?: { hasNextPage?: unknown };
}
interface ApiPrice {
  quote?: unknown;
}

const string = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const normalizeAsset = (node: ApiNode): XStockAsset | null => {
  const symbol = string(node.symbol);
  const name = string(node.name);
  const underlyingSymbol = string(node.underlyingSymbol);
  const mint = node.deployments?.find(
    (deployment) => deployment.network === NETWORK,
  )?.address;
  if (!symbol || !name || !underlyingSymbol || !string(mint)) return null;
  const type = node.underlying?.type;
  return {
    symbol,
    name,
    underlyingSymbol,
    underlyingType: type === 'Equity' || type === 'ETF' ? type : null,
    logo: string(node.logo),
    description: string(node.description),
    mint: string(mint)!,
    isTradingHalted: node.isTradingHalted === true,
    marketOpen:
      typeof node.trading?.openNow === 'boolean' ? node.trading.openNow : null,
    nextChangeAt: string(node.trading?.nextChangeAt),
  };
};

async function inBatches<T>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (next < values.length) {
        const value = values[next++];
        await work(value);
      }
    },
  );
  await Promise.all(workers);
}

export class XStocksService {
  private readonly api: string;
  private catalogCache: XStockCatalog | null = null;
  private catalogRefresh: Promise<XStockCatalog> | null = null;
  private quoteCache = new Map<string, CachedQuote>();
  private quoteRefresh = new Map<string, Promise<void>>();

  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    api = process.env.XSTOCKS_API_URL || 'https://api.xstocks.fi/api/v2',
  ) {
    this.api = api.replace(/\/$/, '');
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(`${this.api}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok)
      throw Error(`xStocks responded with ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }

  private async refreshCatalog(): Promise<XStockCatalog> {
    const readPage = async (page: number) => {
      const response = await this.get<ApiPage>(
        `/public/assets?network=${NETWORK}&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      if (!Array.isArray(response.nodes))
        throw Error('xStocks returned no asset list.');
      return response;
    };
    const first = await readPage(0);
    const pages: ApiNode[] = [...first.nodes!];
    let nextPage = 1;
    let hasNext = first.page?.hasNextPage === true;
    // Follow the issuer's cursor one page at a time. Asking for a speculative
    // page beyond the last one made otherwise healthy one-page catalogs fail
    // when the issuer correctly rejected the out-of-range request.
    while (hasNext) {
      if (nextPage > 199)
        throw Error('xStocks asset pagination exceeded its safety limit.');
      const response = await readPage(nextPage++);
      pages.push(...response.nodes!);
      hasNext = response.page?.hasNextPage === true;
    }
    const assets = pages
      .map(normalizeAsset)
      .filter((asset): asset is XStockAsset => !!asset)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (!assets.length) throw Error('xStocks returned no Solana assets.');
    const next: XStockCatalog = {
      assets,
      refreshedAt: this.now(),
      source: 'xstocks',
    };
    this.catalogCache = next;
    return next;
  }

  async catalog(): Promise<XStockCatalog> {
    if (
      this.catalogCache &&
      this.now() - this.catalogCache.refreshedAt < CATALOG_TTL_MS
    )
      return this.catalogCache;
    if (!this.catalogRefresh) {
      this.catalogRefresh = this.refreshCatalog().finally(() => {
        this.catalogRefresh = null;
      });
    }
    try {
      return await this.catalogRefresh;
    } catch (error) {
      // Existing asset identities remain useful during a transient provider
      // issue. Quotes are still separately labelled and never copied forward.
      if (this.catalogCache) return this.catalogCache;
      throw error;
    }
  }

  private refreshQuote(symbol: string) {
    const current = this.quoteRefresh.get(symbol);
    if (current) return current;
    const run = this.get<ApiPrice>(
      `/public/assets/${encodeURIComponent(symbol)}/price-data`,
    )
      .then((response) => {
        const quote = finite(response.quote);
        const receivedAt = this.now();
        this.quoteCache.set(symbol, {
          symbol,
          quote,
          observedAt: null,
          receivedAt,
          state: quote === null ? 'unavailable' : 'live',
          source: 'xstocks',
          refreshAt: receivedAt + QUOTE_TTL_MS,
        });
      })
      .catch(() => {
        // Failed reads are intentionally not a price. A short-lived pending
        // state lets a later request retry instead of turning a network error
        // into a stale quote with a fresh timestamp.
        const attemptedAt = this.now();
        this.quoteCache.set(symbol, {
          symbol,
          quote: null,
          observedAt: null,
          receivedAt: attemptedAt,
          state: 'unavailable',
          source: 'xstocks',
          refreshAt: attemptedAt + QUOTE_FAILURE_BACKOFF_MS,
        });
      })
      .finally(() => this.quoteRefresh.delete(symbol));
    this.quoteRefresh.set(symbol, run);
    return run;
  }

  /**
   * Returns promptly from cache and refreshes stale symbols in the
   * background. This keeps a slow issuer endpoint from making a watchlist
   * feel stuck, while the browser's short poll picks up each completed mark.
   */
  private quoteSnapshot(input: readonly string[]): XStockQuote[] {
    const symbols = [...new Set(input.map((symbol) => symbol.trim()))]
      .filter(Boolean)
      .slice(0, MAX_QUOTES_PER_REQUEST);
    const now = this.now();
    const refresh = symbols.filter((symbol) => {
      const quote = this.quoteCache.get(symbol);
      return !quote || now >= quote.refreshAt;
    });
    // Do not await a remote pricing round. A quote source that is slow or
    // closed should yield a clear unavailable state, not hold the full view.
    void inBatches(refresh, MAX_CONCURRENT_QUOTES, async (symbol) => {
      await this.refreshQuote(symbol);
    });
    return symbols.map((symbol) => {
      const cached = this.quoteCache.get(symbol);
      if (cached) {
        const { refreshAt: _refreshAt, ...quote } = cached;
        return quote;
      }
      return {
        symbol,
        quote: null,
        observedAt: null,
        receivedAt: null,
        state: 'pending' as const,
        source: 'xstocks' as const,
      };
    });
  }

  /**
   * Issuer prices for symbols that a caller has already resolved from the
   * issuer's own catalog. This avoids making a persisted catalog wait for a
   * second full pagination walk before its direct price refresh can start.
   */
  async quotesForVerifiedSymbols(
    input: readonly string[],
  ): Promise<XStockQuote[]> {
    return this.quoteSnapshot(input);
  }

  async quotes(input: readonly string[]): Promise<XStockQuote[]> {
    const catalog = await this.catalog();
    const allowed = new Set(catalog.assets.map((asset) => asset.symbol));
    return this.quoteSnapshot(
      input.filter((symbol) => allowed.has(symbol.trim())),
    );
  }
}
