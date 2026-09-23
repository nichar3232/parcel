import type { TokenizedEquityAsset, TokenizedEquityQuote } from './types';

const API = 'https://api.gm.ondo.finance';
const CATALOG_TTL_MS = 15 * 60_000;
const QUOTE_TTL_MS = 5_000;
const FAILURE_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface RawAddress {
  networkChainId?: unknown;
  address?: unknown;
}
interface RawMetadata {
  symbol?: unknown;
  ticker?: unknown;
  name?: unknown;
  displayName?: unknown;
  underlyingSymbol?: unknown;
  tags?: { instrumentType?: unknown; assetClass?: unknown };
  logoURI?: unknown;
  description?: unknown;
  addresses?: RawAddress[];
}
interface RawPrice {
  symbol?: unknown;
  price?: unknown;
  timestamp?: unknown;
  primaryMarket?: {
    symbol?: unknown;
    price?: unknown;
    timestamp?: unknown;
  };
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
const observedAt = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

// Ondo's API returns a chain label rather than a Solana mint convention. Keep
// this intentionally strict: an unknown deployment is not presented as a
// Solana instrument just because it shares an equity ticker.
const solanaAddress = (addresses: unknown): string | null => {
  if (!Array.isArray(addresses)) return null;
  for (const deployment of addresses) {
    const record = deployment as RawAddress;
    const network = text(record.networkChainId)?.toLowerCase() ?? '';
    if (network.includes('solana') || network === '900') {
      const address = text(record.address);
      if (address) return address;
    }
  }
  return null;
};

/**
 * Optional Ondo Stocks issuer adapter.
 *
 * Ondo's inventory and price endpoints require an issuer API key. The adapter
 * stays explicitly unavailable without it; it never substitutes a public
 * equity quote or a modelled value for an Ondo token.
 */
export class OndoService {
  private catalogCache: { assets: TokenizedEquityAsset[]; at: number } | null =
    null;
  private catalogRefresh: Promise<TokenizedEquityAsset[]> | null = null;
  private quoteCache = new Map<string, CachedQuote>();
  private quoteRefresh: Promise<void> | null = null;

  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly api = process.env.ONDO_API_URL || API,
    private readonly apiKey = process.env.ONDO_API_KEY || '',
  ) {}

  get configured() {
    return Boolean(this.apiKey.trim());
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.configured) throw Error('Ondo API key is not configured.');
    const response = await this.request(
      `${this.api.replace(/\/$/, '')}${path}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok)
      throw Error(`Ondo responded with ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }

  private async refreshCatalog() {
    const response = await this.get<RawMetadata[]>('/v1/assets/all/metadata');
    if (!Array.isArray(response)) throw Error('Ondo returned no asset list.');
    const assets = response
      .flatMap((asset): TokenizedEquityAsset[] => {
        const symbol = text(asset.symbol) ?? text(asset.ticker);
        const mint = solanaAddress(asset.addresses);
        const kind =
          `${text(asset.tags?.instrumentType) ?? ''} ${text(asset.tags?.assetClass) ?? ''}`.toLowerCase();
        if (!symbol || !mint || !/(equity|stock|etf)/.test(kind)) return [];
        return [
          {
            id: `ondo:${symbol}`,
            provider: 'ondo',
            providerName: 'Ondo Stocks',
            symbol,
            name: text(asset.displayName) ?? text(asset.name) ?? symbol,
            underlyingSymbol:
              text(asset.underlyingSymbol) ?? text(asset.ticker) ?? symbol,
            underlyingType: kind.includes('etf') ? 'ETF' : 'Equity',
            logo: text(asset.logoURI),
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
    if (!this.configured) return [];
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

  private refreshQuotes(ids: readonly string[]) {
    if (this.quoteRefresh) return this.quoteRefresh;
    const run = Promise.all([
      this.catalog(),
      this.get<RawPrice[]>('/v1/assets/all/prices/latest'),
    ])
      .then(([assets, response]) => {
        if (!Array.isArray(response))
          throw Error('Ondo returned no price list.');
        const idBySymbol = new Map(
          assets.map((asset) => [asset.symbol, asset.id]),
        );
        const refreshAt = this.now() + QUOTE_TTL_MS;
        const returned = new Set<string>();
        for (const entry of response) {
          const symbol =
            text(entry.primaryMarket?.symbol) ?? text(entry.symbol);
          const id = symbol ? idBySymbol.get(symbol) : null;
          if (!id) continue;
          returned.add(id);
          const quote = number(entry.primaryMarket?.price ?? entry.price);
          this.quoteCache.set(id, {
            id,
            quote,
            observedAt: observedAt(
              entry.primaryMarket?.timestamp ?? entry.timestamp,
              this.now(),
            ),
            state: quote === null ? 'unavailable' : 'live',
            provider: 'ondo',
            refreshAt,
          });
        }
        // The issuer's all-prices response is authoritative for the refresh.
        // A listed token absent from it is unpriced, not pending indefinitely.
        for (const id of ids)
          if (!returned.has(id))
            this.quoteCache.set(id, {
              id,
              quote: null,
              observedAt: null,
              state: 'unavailable',
              provider: 'ondo',
              refreshAt,
            });
      })
      .catch(() => {
        const refreshAt = this.now() + FAILURE_BACKOFF_MS;
        for (const id of ids)
          this.quoteCache.set(id, {
            id,
            quote: null,
            observedAt: null,
            state: 'unavailable',
            provider: 'ondo',
            refreshAt,
          });
      })
      .finally(() => {
        this.quoteRefresh = null;
      });
    this.quoteRefresh = run;
    return run;
  }

  async quotes(input: readonly string[]): Promise<TokenizedEquityQuote[]> {
    if (!this.configured) return [];
    const assets = await this.catalog();
    const allowed = new Set(assets.map((asset) => asset.id));
    const ids = [...new Set(input)].filter((id) => allowed.has(id));
    const now = this.now();
    if (
      ids.some(
        (id) =>
          !this.quoteCache.get(id) || now >= this.quoteCache.get(id)!.refreshAt,
      )
    )
      void this.refreshQuotes(ids);
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
        provider: 'ondo' as const,
      };
    });
  }
}
