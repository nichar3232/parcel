import { XStocksService } from '../xstocks/service';
import { OndoService } from './ondo';
import { SuperstateService } from './superstate';
import type {
  TokenizedEquityAsset,
  TokenizedEquityCatalog,
  TokenizedEquityProvider,
  TokenizedEquityQuote,
  TokenizedEquitySource,
} from './types';

const source = (
  id: TokenizedEquityProvider,
  name: string,
  state: TokenizedEquitySource['state'],
  assets: number,
  detail: string,
): TokenizedEquitySource => ({ id, name, state, assets, detail });

/**
 * Aggregates issuer-owned Solana equity token registries. This is deliberately
 * not a generic SPL-token scanner: a token only appears after its issuer has
 * declared the Solana deployment and a source-qualified identity is retained
 * through the quote path.
 */
export class TokenizedEquitiesService {
  constructor(
    private readonly xstocks = new XStocksService(),
    private readonly superstate = new SuperstateService(),
    private readonly ondo = new OndoService(),
    private readonly now: () => number = Date.now,
  ) {}

  async catalog(): Promise<TokenizedEquityCatalog> {
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
      sources.push(
        source(
          'xstocks',
          'xStocks',
          'unavailable',
          0,
          'Issuer registry unavailable',
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
      sources.push(
        source(
          'superstate',
          'Opening Bell',
          'unavailable',
          0,
          'Issuer registry unavailable',
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
      sources.push(
        source(
          'ondo',
          'Ondo Stocks',
          'unavailable',
          0,
          'Issuer registry unavailable',
        ),
      );
    }

    const catalog = {
      assets: assets.sort((a, b) =>
        a.providerName === b.providerName
          ? a.symbol.localeCompare(b.symbol)
          : a.providerName.localeCompare(b.providerName),
      ),
      sources,
      refreshedAt: this.now(),
    };
    return catalog;
  }

  async quotes(input: readonly string[]): Promise<TokenizedEquityQuote[]> {
    const catalog = await this.catalog();
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
    const [xstocks, superstate, ondo] = await Promise.allSettled([
      this.xstocks.quotes(grouped.xstocks.map((asset) => asset.symbol)),
      this.superstate.quotes(grouped.superstate.map((asset) => asset.id)),
      this.ondo.quotes(grouped.ondo.map((asset) => asset.id)),
    ]);
    const quotes: TokenizedEquityQuote[] = [];
    if (xstocks.status === 'fulfilled')
      quotes.push(
        ...xstocks.value.map((quote) => ({
          id: `xstocks:${quote.symbol}`,
          quote: quote.quote,
          observedAt: quote.observedAt,
          receivedAt: quote.receivedAt,
          state: quote.state,
          provider: 'xstocks' as const,
        })),
      );
    if (superstate.status === 'fulfilled') quotes.push(...superstate.value);
    if (ondo.status === 'fulfilled') quotes.push(...ondo.value);
    return quotes;
  }
}
