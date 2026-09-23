'use client';

import { ExternalLink, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { company, usePreIpoAssets } from '@/hooks/parcel/use-preipo';
import {
  useTokenizedEquities,
  useTokenizedEquityQuotes,
  type TokenizedEquityAsset,
  type TokenizedEquityQuote,
} from '@/hooks/parcel/use-tokenized-equities';
import type { ProviderQuote } from '@/lib/preipo/types';
import { AssetLogo } from './AssetLogo';
import { Empty } from './shared';
import { compact, pct, usd } from './shared';

const STORAGE_KEY = 'parcel.watchlist.v4';
const LEGACY_STORAGE_KEYS = [
  'parcel.watchlist.v3',
  'parcel.watchlist.v2',
  'parcel.watchlist.prestocks.v1',
];
const DEFAULT_XSTOCKS = [
  'NVDAx',
  'AAPLx',
  'MSFTx',
  'AMZNx',
  'GOOGLx',
  'METAx',
  'TSLAx',
];

type Scope = 'all' | 'tokenized' | 'prestocks';
type WatchId = `tokenized:${string}` | `prestocks:${string}`;
interface WatchPreference {
  included: WatchId[];
}

const tokenizedId = (id: string): WatchId => `tokenized:${id}`;
const xstockId = (symbol: string): WatchId => tokenizedId(`xstocks:${symbol}`);
const prestocksId = (mint: string): WatchId => `prestocks:${mint}`;

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null;

const descriptionOf = (quote: ProviderQuote) =>
  text(quote.meta.description)?.split('\n')[0] ?? null;

const urlOf = (quote: ProviderQuote) => text(quote.meta.externalUrl);

const imageOf = (quote: ProviderQuote) => text(quote.meta.image);

const tokenPriceOf = (quote: ProviderQuote) => number(quote.meta.tokenPrice);

const valuationOf = (quote: ProviderQuote) =>
  number(quote.meta.impliedValuation) ?? number(quote.meta.markValuation);

const matchesPreStocks = (quote: ProviderQuote, query: string) => {
  const haystack =
    `${company(quote.displayName)} ${quote.symbol} ${descriptionOf(quote) ?? ''}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
};

const matchesTokenized = (asset: TokenizedEquityAsset, query: string) =>
  `${asset.name} ${asset.symbol} ${asset.underlyingSymbol} ${asset.providerName} ${asset.description ?? ''}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());

const asWatchIds = (values: unknown[]): WatchId[] =>
  values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    if (value.startsWith('tokenized:') || value.startsWith('prestocks:'))
      return [value as WatchId];
    if (value.startsWith('xstock:')) return [xstockId(value.slice(7))];
    // Version two represented traditional-ticker stand-ins as equities.
    // Keep a person's follows when a matching issuer xStock exists, without
    // keeping the old modelled-equity identity in the product.
    if (value.startsWith('equity:')) return [xstockId(`${value.slice(7)}x`)];
    // The oldest watchlist stored raw publisher mints.
    return [prestocksId(value)];
  });

const readSaved = (): WatchPreference | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
        Boolean,
      ) ??
      'null';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { included: asWatchIds(parsed) };
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    // `included: null` was the old “show every item in the catalog” mode.
    // A live issuer catalog can contain hundreds of assets, so use a compact
    // practical default rather than turning a migration into a 900-row page.
    return Array.isArray(record.included)
      ? { included: asWatchIds(record.included) }
      : null;
  } catch {
    return null;
  }
};

function PreStocksIdentity({ quote }: { quote: ProviderQuote }) {
  const description = descriptionOf(quote);
  return (
    <div className="od-watchlist-company">
      <AssetLogo
        symbol={company(quote.displayName)}
        src={imageOf(quote)}
        size={34}
      />
      <div>
        <b>{company(quote.displayName)}</b>
        <small>{quote.symbol} · PreStocks</small>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function TokenizedIdentity({ asset }: { asset: TokenizedEquityAsset }) {
  return (
    <div className="od-watchlist-company">
      <AssetLogo symbol={asset.underlyingSymbol} src={asset.logo} size={34} />
      <div>
        <b>{asset.name}</b>
        <small>
          {asset.symbol} · {asset.underlyingSymbol} · {asset.providerName} ·
          Solana
        </small>
      </div>
    </div>
  );
}

function Price({ value }: { value: number | null | undefined }) {
  return <b>{value == null ? '—' : usd(value)}</b>;
}

function quoteState(
  quote: TokenizedEquityQuote | undefined,
  asset: TokenizedEquityAsset,
) {
  if (!quote || quote.state === 'pending') return 'Refreshing';
  if (asset.isTradingHalted) return 'Halted';
  if (quote.state === 'unavailable')
    return asset.marketOpen === false ? 'Market closed' : 'Quote unavailable';
  return asset.marketOpen === true ? 'Market open' : 'Issuer quote';
}

function quoteTime(quote: TokenizedEquityQuote | undefined) {
  if (!quote?.observedAt) return '—';
  return new Date(quote.observedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function TokenizedRow({
  asset,
  quote,
  onRemove,
}: {
  asset: TokenizedEquityAsset;
  quote?: TokenizedEquityQuote;
  onRemove: () => void;
}) {
  const state = quoteState(quote, asset);
  return (
    <article className="od-watchlist-row od-watchlist-tokenized-row">
      <TokenizedIdentity asset={asset} />
      <div className="od-watchlist-metric">
        <span>Issuer quote</span>
        <Price value={quote?.quote} />
      </div>
      <div className="od-watchlist-metric">
        <span>Status</span>
        <b
          className={
            quote?.state === 'live' && !asset.isTradingHalted ? 'od-up' : ''
          }
        >
          {state}
        </b>
      </div>
      <div className="od-watchlist-metric od-watchlist-source-cell">
        <span>Updated</span>
        <b>{quote?.observedAt ? `${quoteTime(quote)} UTC` : '—'}</b>
      </div>
      <div className="od-watchlist-actions">
        <a
          href={`https://solscan.io/token/${asset.mint}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Inspect ${asset.symbol} mint on Solscan`}
          title="Inspect Solana mint"
        >
          <ExternalLink size={15} />
        </a>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${asset.name} from watchlist`}
          title="Remove from watchlist"
        >
          <X size={15} />
        </button>
      </div>
    </article>
  );
}

function PreStocksRow({
  quote,
  onRemove,
}: {
  quote: ProviderQuote;
  onRemove: () => void;
}) {
  const mark = quote.markPriceUsd;
  const token = tokenPriceOf(quote);
  const spread = mark && token ? token / mark - 1 : null;
  const external = urlOf(quote);

  return (
    <article className="od-watchlist-row od-watchlist-private-row">
      <PreStocksIdentity quote={quote} />
      <div className="od-watchlist-metric">
        <span>Mark</span>
        <Price value={mark} />
      </div>
      <div className="od-watchlist-metric">
        <span>Token</span>
        <Price value={token} />
      </div>
      <div className="od-watchlist-metric">
        <span>Implied value</span>
        <b>{valuationOf(quote) == null ? '—' : compact(valuationOf(quote)!)}</b>
      </div>
      <div className="od-watchlist-metric">
        <span>Token vs mark</span>
        <b className={spread == null ? '' : spread >= 0 ? 'od-up' : 'od-down'}>
          {spread == null ? '—' : pct(spread)}
        </b>
      </div>
      <div className="od-watchlist-actions">
        {external && (
          <a
            href={external}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${company(quote.displayName)} at PreStocks`}
            title="Open at PreStocks"
          >
            <ExternalLink size={15} />
          </a>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${company(quote.displayName)} from watchlist`}
          title="Remove from watchlist"
        >
          <X size={15} />
        </button>
      </div>
    </article>
  );
}

function TokenizedResult({
  asset,
  onAdd,
}: {
  asset: TokenizedEquityAsset;
  onAdd: () => void;
}) {
  return (
    <article className="od-watchlist-result">
      <TokenizedIdentity asset={asset} />
      <div>
        <span>{asset.providerName}</span>
        <b>{asset.underlyingType ?? 'Tokenized asset'}</b>
      </div>
      <button type="button" onClick={onAdd}>
        <Plus size={14} /> Add
      </button>
    </article>
  );
}

function PreStocksResult({
  quote,
  onAdd,
}: {
  quote: ProviderQuote;
  onAdd: () => void;
}) {
  return (
    <article className="od-watchlist-result">
      <PreStocksIdentity quote={quote} />
      <div>
        <span>Mark</span>
        <Price value={quote.markPriceUsd} />
      </div>
      <button type="button" onClick={onAdd}>
        <Plus size={14} /> Add
      </button>
    </article>
  );
}

function SectionHead({
  id,
  title,
  detail,
}: {
  id: string;
  title: string;
  detail: string;
}) {
  return (
    <header className="od-watchlist-section-head">
      <b id={id}>{title}</b>
      <span>{detail}</span>
    </header>
  );
}

/**
 * A reader-controlled watchlist with distinct issuer and publisher sources.
 * Issuer entries are sourced from their declared Solana registries. Their
 * prices remain blank during a halt, closure, or provider outage rather than
 * being filled with a related equity or simulated mark.
 */
export function WatchlistView() {
  const { data: tokenized, error: tokenizedError } = useTokenizedEquities();
  const { data: preipo, error: preipoError } = usePreIpoAssets();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [preference, setPreference] = useState<WatchPreference | null>(
    readSaved,
  );

  const tokenizedCatalog = useMemo(() => tokenized?.assets ?? [], [tokenized]);
  const preStocksCatalog = useMemo(
    () =>
      [...(preipo?.catalog ?? [])].sort((a, b) =>
        company(a.displayName).localeCompare(company(b.displayName)),
      ),
    [preipo],
  );
  const defaultIds = useMemo<WatchId[]>(
    () => [
      ...DEFAULT_XSTOCKS.filter((symbol) =>
        tokenizedCatalog.some((asset) => asset.id === `xstocks:${symbol}`),
      ).map(xstockId),
      ...['superstate:FWDI', 'superstate:GLXY']
        .filter((id) => tokenizedCatalog.some((asset) => asset.id === id))
        .map(tokenizedId),
      ...preStocksCatalog.map((quote) => prestocksId(quote.mint)),
    ],
    [tokenizedCatalog, preStocksCatalog],
  );
  const savedIds = preference?.included ?? defaultIds;
  const selected = useMemo(() => new Set(savedIds), [savedIds]);
  const watchedTokenized = useMemo(
    () =>
      savedIds
        .filter((id) => id.startsWith('tokenized:'))
        .map((id) =>
          tokenizedCatalog.find((asset) => tokenizedId(asset.id) === id),
        )
        .filter((asset): asset is TokenizedEquityAsset => Boolean(asset))
        .filter((asset) => matchesTokenized(asset, query)),
    [savedIds, tokenizedCatalog, query],
  );
  const quotes = useTokenizedEquityQuotes(
    watchedTokenized.map((asset) => asset.id),
  );
  const watchedPreStocks = useMemo(
    () =>
      savedIds
        .filter((id) => id.startsWith('prestocks:'))
        .map((id) =>
          preStocksCatalog.find((quote) => prestocksId(quote.mint) === id),
        )
        .filter((quote): quote is ProviderQuote => Boolean(quote))
        .filter((quote) => matchesPreStocks(quote, query)),
    [savedIds, preStocksCatalog, query],
  );
  const tokenizedAdditions = tokenizedCatalog.filter(
    (asset) =>
      !selected.has(tokenizedId(asset.id)) &&
      query.trim() &&
      matchesTokenized(asset, query),
  );
  const preStocksAdditions = preStocksCatalog.filter(
    (quote) =>
      !selected.has(prestocksId(quote.mint)) &&
      query.trim() &&
      matchesPreStocks(quote, query),
  );
  const refreshed = preipo
    ? new Date(preipo.refreshedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      })
    : null;
  const liveQuotes = Object.values(quotes).filter(
    (quote) => quote.state === 'live',
  ).length;

  useEffect(() => {
    if (preference !== null)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  }, [preference]);

  const remove = (id: WatchId) =>
    setPreference((current) => ({
      included: (current?.included ?? defaultIds).filter((item) => item !== id),
    }));
  const add = (id: WatchId) =>
    setPreference((current) => {
      const included = current?.included ?? defaultIds;
      return included.includes(id)
        ? { included }
        : { included: [...included, id] };
    });
  const showTokenized = scope !== 'prestocks';
  const showPreStocks = scope !== 'tokenized';
  const totalListed = tokenizedCatalog.length + preStocksCatalog.length;
  const liveSources =
    tokenized?.sources.filter((source) => source.state === 'live') ?? [];
  const sourceSummary = liveSources
    .map((source) => `${source.name} ${source.assets}`)
    .join(' · ');

  return (
    <section className="od-watchlist" aria-labelledby="watchlist-title">
      <header className="od-watchlist-head">
        <div>
          <span className="od-watchlist-kicker">Portfolio</span>
          <h2 id="watchlist-title">Watchlist</h2>
          <p>
            Public tokenized equities and publisher marks for the instruments
            you follow.
          </p>
        </div>
        <div className="od-watchlist-source">
          <b>Equities + PreStocks</b>
          <span>
            {sourceSummary || 'Reading issuer registries'} ·{' '}
            {preStocksCatalog.length} PreStocks
          </span>
        </div>
      </header>

      <div className="od-watchlist-toolbar">
        <label className="od-watchlist-search">
          <Search size={16} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tokenized equities and PreStocks"
            aria-label="Search tokenized equities and PreStocks"
          />
          <span>{totalListed || '—'} instruments</span>
        </label>
        <div
          className="od-watchlist-filter"
          role="tablist"
          aria-label="Watchlist sources"
        >
          {(
            [
              ['all', 'All'],
              ['tokenized', 'Tokenized equities'],
              ['prestocks', 'PreStocks'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={scope === id}
              className={scope === id ? 'selected' : ''}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {(tokenizedAdditions.length > 0 || preStocksAdditions.length > 0) && (
        <section className="od-watchlist-results" aria-label="Add to watchlist">
          <div className="od-watchlist-results-head">
            <span>Catalog matches</span>
            <small>Add an instrument to this browser’s watchlist.</small>
          </div>
          {tokenizedAdditions.slice(0, 12).map((asset) => (
            <TokenizedResult
              key={asset.id}
              asset={asset}
              onAdd={() => add(tokenizedId(asset.id))}
            />
          ))}
          {preStocksAdditions.slice(0, 12).map((quote) => (
            <PreStocksResult
              key={quote.mint}
              quote={quote}
              onAdd={() => add(prestocksId(quote.mint))}
            />
          ))}
        </section>
      )}

      {showTokenized && (
        <section
          className="od-watchlist-section"
          aria-labelledby="watchlist-tokenized"
        >
          <SectionHead
            id="watchlist-tokenized"
            title="Solana tokenized equities"
            detail={
              tokenizedError
                ? 'Issuer catalog temporarily unavailable'
                : tokenized
                  ? `${tokenizedCatalog.length} issuer assets · ${liveQuotes}/${watchedTokenized.length} current quotes`
                  : 'Reading issuer registries'
            }
          />
          {tokenized && (
            <p className="od-watchlist-provider-status">
              {tokenized.sources
                .map((source) =>
                  source.state === 'live'
                    ? `${source.name}: ${source.assets} listed`
                    : `${source.name}: ${source.detail.toLowerCase()}`,
                )
                .join(' · ')}
            </p>
          )}
          <div className="od-watchlist-table od-watchlist-tokenized">
            <div className="od-watchlist-labels" aria-hidden="true">
              <span>Instrument</span>
              <span>Issuer quote</span>
              <span>Status</span>
              <span>Updated</span>
              <span />
            </div>
            {watchedTokenized.length ? (
              watchedTokenized.map((asset) => (
                <TokenizedRow
                  key={asset.id}
                  asset={asset}
                  quote={quotes[asset.id]}
                  onRemove={() => remove(tokenizedId(asset.id))}
                />
              ))
            ) : (
              <Empty
                title={
                  query
                    ? 'No watched tokenized equities match'
                    : 'No tokenized equities watched'
                }
                description="Search the issuer registries above to add a Solana tokenized equity."
              />
            )}
          </div>
        </section>
      )}

      {showPreStocks && (
        <section
          className="od-watchlist-section"
          aria-labelledby="watchlist-prestocks"
        >
          <SectionHead
            id="watchlist-prestocks"
            title="PreStocks"
            detail={
              preipoError
                ? 'Publisher data temporarily unavailable'
                : preipo
                  ? `${preStocksCatalog.length} listed · updated ${refreshed} UTC`
                  : 'Reading publisher catalog'
            }
          />
          <div className="od-watchlist-table od-watchlist-private">
            <div className="od-watchlist-labels" aria-hidden="true">
              <span>Company</span>
              <span>Mark</span>
              <span>Token</span>
              <span>Implied value</span>
              <span>Token vs mark</span>
              <span />
            </div>
            {preipo && watchedPreStocks.length ? (
              watchedPreStocks.map((quote) => (
                <PreStocksRow
                  key={quote.mint}
                  quote={quote}
                  onRemove={() => remove(prestocksId(quote.mint))}
                />
              ))
            ) : (
              <Empty
                title={
                  preipoError
                    ? 'PreStocks catalog unavailable'
                    : query
                      ? 'No watched PreStocks match'
                      : 'No PreStocks watched'
                }
                description={
                  preipoError
                    ? 'The next publisher refresh will restore your saved instruments.'
                    : query
                      ? 'Try another company name or symbol, then add a catalog match.'
                      : 'Search the PreStocks catalog above to add an instrument.'
                }
              />
            )}
          </div>
        </section>
      )}
    </section>
  );
}
