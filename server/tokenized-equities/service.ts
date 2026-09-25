import { XStocksService } from '../xstocks/service';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OndoService } from './ondo';
import { SuperstateService } from './superstate';
import type {
  TokenizedEquityAsset,
  TokenizedEquityCatalog,
  TokenizedEquityProvider,
  TokenizedEquityQuote,
  TokenizedEquitySource,
} from './types';

const CATALOG_TTL_MS = 15 * 60_000;
const CATALOG_RETRY_MS = 30_000;

const source = (
  id: TokenizedEquityProvider,
  name: string,
  state: TokenizedEquitySource['state'],
  assets: number,
  detail: string,
): TokenizedEquitySource => ({ id, name, state, assets, detail });

const sourceStates = new Set<TokenizedEquitySource['state']>([
  'live',
  'cached',
  'pending',
  'unavailable',
  'not-configured',
]);
const providers = new Set<TokenizedEquityProvider>([
  'xstocks',
  'superstate',
  'ondo',
]);

/** A catalog cache holds identifiers only; it never contains a price. */
function readCatalogCache(
  file: string | undefined,
): TokenizedEquityCatalog | null {
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.assets) || !Array.isArray(record.sources))
      return null;
    const assets = record.assets.filter(
      (value): value is TokenizedEquityAsset => {
        if (!value || typeof value !== 'object') return false;
        const asset = value as Record<string, unknown>;
        return (
          typeof asset.id === 'string' &&
          typeof asset.symbol === 'string' &&
          typeof asset.name === 'string' &&
          typeof asset.underlyingSymbol === 'string' &&
          typeof asset.mint === 'string' &&
          typeof asset.provider === 'string' &&
          providers.has(asset.provider as TokenizedEquityProvider)
        );
      },
    );
    const sources = record.sources.filter(
      (value): value is TokenizedEquitySource => {
        if (!value || typeof value !== 'object') return false;
        const item = value as Record<string, unknown>;
        return (
          typeof item.id === 'string' &&
          providers.has(item.id as TokenizedEquityProvider) &&
          typeof item.name === 'string' &&
          typeof item.assets === 'number' &&
          typeof item.detail === 'string' &&
          typeof item.state === 'string' &&
          sourceStates.has(item.state as TokenizedEquitySource['state'])
        );
      },
    );
    const refreshedAt = record.refreshedAt;
    if (
      !assets.length ||
      sources.length !== 3 ||
      typeof refreshedAt !== 'number' ||
      !Number.isFinite(refreshedAt)
    )
      return null;
    return {
      assets,
      // A restarted process has not yet rechecked the issuer. Do not present
      // the persisted inventory as a live catalog before that happens.
      sources: sources.map((item) =>
        item.state === 'live'
          ? {
              ...item,
              state: 'cached' as const,
              detail: 'Cached issuer registry',
            }
          : item,
      ),
      refreshedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Aggregates issuer-owned Solana equity token registries. This is deliberately
 * not a generic SPL-token scanner: a token only appears after its issuer has
 * declared the Solana deployment and a source-qualified identity is retained
 * through the quote path.
 */
export class TokenizedEquitiesService {
  private catalogCache: TokenizedEquityCatalog | null;
  private catalogRefresh: Promise<TokenizedEquityCatalog> | null = null;

  constructor(
    private readonly xstocks = new XStocksService(),
    private readonly superstate = new SuperstateService(),
    private readonly ondo = new OndoService(),
    private readonly now: () => number = Date.now,
    options: { cacheFile?: string } = {},
  ) {
    this.catalogCache = readCatalogCache(options.cacheFile);
    this.cacheFile = options.cacheFile;
  }

  private readonly cacheFile?: string;

  private persist(catalog: TokenizedEquityCatalog) {
    if (!this.cacheFile) return;
    // A failed source should not erase a verified catalog from the next boot.
    if (
      !catalog.assets.length ||
      !catalog.sources.some((s) => s.state === 'live')
    )
      return;
    const file = this.cacheFile;
    const saved: TokenizedEquityCatalog = {
      ...catalog,
      sources: catalog.sources.map((item) =>
        item.state === 'live'
          ? {
              ...item,
              state: 'cached' as const,
              detail: 'Cached issuer registry',
            }
          : item,
      ),
    };
    const temporary = `${file}.${process.pid}.tmp`;
    void mkdir(path.dirname(file), { recursive: true })
      .then(() => writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }))
      .then(() => rename(temporary, file))
      // This cache affects view latency, not the integrity of issuer data.
      // A write failure simply leaves the in-memory response path intact.
      .catch(() => undefined);
  }

  private priorAssets(provider: TokenizedEquityProvider) {
    return (
      this.catalogCache?.assets.filter(
        (asset) => asset.provider === provider,
      ) ?? []
    );
  }

  private pendingCatalog(): TokenizedEquityCatalog {
    const pending = (id: TokenizedEquityProvider, name: string) =>
      source(id, name, 'pending', 0, 'Refreshing issuer registry');
    return {
      assets: [],
      sources: [
        pending('xstocks', 'xStocks'),
        pending('superstate', 'Opening Bell'),
        this.ondo.configured
          ? pending('ondo', 'Ondo Stocks')
          : source(
              'ondo',
              'Ondo Stocks',
              'not-configured',
              0,
              'Issuer API key required',
            ),
      ],
      refreshedAt: this.now(),
    };
  }

  private async refreshCatalog(): Promise<TokenizedEquityCatalog> {
    const [xstocks, superstate, ondo] = await Promise.allSettled([
      this.xstocks.catalog(),
      this.superstate.catalog(),
      this.ondo.catalog(),
    ]);
    const assets: TokenizedEquityAsset[] = [];
    const sources: TokenizedEquitySource[] = [];

    if (xstocks.status === 'fulfilled') {
      assets.push(
        ...xstocks.value.assets.map((asset) => ({
          ...asset,
          id: `xstocks:${asset.symbol}`,
          provider: 'xstocks' as const,
          providerName: 'xStocks',
        })),
      );
      sources.push(
        source(
          'xstocks',
          'xStocks',
          'live',
          xstocks.value.assets.length,
          'Public issuer registry',
        ),
      );
    } else {
      const prior = this.priorAssets('xstocks');
      assets.push(...prior);
      sources.push(
        source(
          'xstocks',
          'xStocks',
          prior.length ? 'cached' : 'unavailable',
          prior.length,
          prior.length
            ? 'Cached issuer registry; refresh unavailable'
            : 'Issuer registry unavailable',
        ),
      );
    }

    if (superstate.status === 'fulfilled') {
      assets.push(...superstate.value);
      sources.push(
        source(
          'superstate',
          'Opening Bell',
          'live',
          superstate.value.length,
          'Public issuer registry',
        ),
      );
    } else {
      const prior = this.priorAssets('superstate');
      assets.push(...prior);
      sources.push(
        source(
          'superstate',
          'Opening Bell',
          prior.length ? 'cached' : 'unavailable',
          prior.length,
          prior.length
            ? 'Cached issuer registry; refresh unavailable'
            : 'Issuer registry unavailable',
        ),
      );
    }

    if (!this.ondo.configured) {
      sources.push(
        source(
          'ondo',
          'Ondo Stocks',
          'not-configured',
          0,
          'Issuer API key required',
        ),
      );
    } else if (ondo.status === 'fulfilled') {
      assets.push(...ondo.value);
      sources.push(
        source(
          'ondo',
          'Ondo Stocks',
          'live',
          ondo.value.length,
          'Credentialed issuer registry',
        ),
      );
    } else {
      const prior = this.priorAssets('ondo');
      assets.push(...prior);
      sources.push(
        source(
          'ondo',
          'Ondo Stocks',
          prior.length ? 'cached' : 'unavailable',
          prior.length,
          prior.length
            ? 'Cached issuer registry; refresh unavailable'
            : 'Issuer registry unavailable',
        ),
      );
    }

    const catalog: TokenizedEquityCatalog = {
      assets: assets.sort((a, b) =>
        a.providerName === b.providerName
          ? a.symbol.localeCompare(b.symbol)
          : a.providerName.localeCompare(b.providerName),
      ),
      sources,
      refreshedAt: this.now(),
    };
    this.catalogCache = catalog;
    this.persist(catalog);
    return catalog;
  }

  private refresh() {
    if (!this.catalogRefresh)
      this.catalogRefresh = this.refreshCatalog().finally(() => {
        this.catalogRefresh = null;
      });
    return this.catalogRefresh;
  }

  private catalogTtl(catalog: TokenizedEquityCatalog) {
    // A complete issuer catalog is slow-changing. A provider failure is not:
    // retry it promptly while still returning the last coherent aggregate to
    // every browser in the meantime.
    return catalog.sources.some(
      (source) => source.state === 'unavailable' || source.state === 'cached',
    )
      ? CATALOG_RETRY_MS
      : CATALOG_TTL_MS;
  }

  /**
   * Read through to an issuer catalog. Background services and tests use this
   * when they need a fully resolved inventory rather than a UI snapshot.
   */
  async catalog(): Promise<TokenizedEquityCatalog> {
    if (
      this.catalogCache &&
      this.now() - this.catalogCache.refreshedAt <
        this.catalogTtl(this.catalogCache)
    )
      return this.catalogCache;
    try {
      return await this.refresh();
    } catch (error) {
      if (this.catalogCache) return this.catalogCache;
      throw error;
    }
  }

  /**
   * Fast stale-while-refreshing catalog for browser routes. A cold registry
   * never holds the watchlist connection open; it renders a truthful loading
   * source immediately and one server-side refresh is shared by every tab.
   */
  snapshot(): TokenizedEquityCatalog {
    const cached = this.catalogCache;
    if (!cached || this.now() - cached.refreshedAt >= this.catalogTtl(cached))
      void this.refresh().catch(() => undefined);
    return cached ?? this.pendingCatalog();
  }

  /** Start the first issuer fetch at server boot instead of on first view. */
  warm() {
    void this.refresh().catch(() => undefined);
  }

  async quotes(input: readonly string[]): Promise<TokenizedEquityQuote[]> {
    // Once a catalog has been discovered, do not make a quote request wait on
    // a background inventory refresh. The issuer adapters own their own
    // per-symbol quote caches and single-flight refreshes.
    const catalog = this.catalogCache ?? (await this.catalog());
    const wanted = new Set(input);
    const grouped = {
      xstocks: catalog.assets.filter(
        (asset) => wanted.has(asset.id) && asset.provider === 'xstocks',
      ),
      superstate: catalog.assets.filter(
        (asset) => wanted.has(asset.id) && asset.provider === 'superstate',
      ),
      ondo: catalog.assets.filter(
        (asset) => wanted.has(asset.id) && asset.provider === 'ondo',
      ),
    };
    const [xstocks, superstate, ondo] = await Promise.all([
      this.xstocks.quotesForVerifiedSymbols(
        grouped.xstocks.map((asset) => asset.symbol),
      ),
      this.superstate.quotesForVerifiedAssets(grouped.superstate),
      this.ondo.quotesForVerifiedAssets(grouped.ondo),
    ]);
    return [
      ...xstocks.map((quote) => ({
        id: `xstocks:${quote.symbol}`,
        quote: quote.quote,
        observedAt: quote.observedAt,
        receivedAt: quote.receivedAt,
        state: quote.state,
        provider: 'xstocks' as const,
      })),
      ...superstate,
      ...ondo,
    ];
  }
}
