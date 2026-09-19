'use client';

import { ExternalLink, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Mark, MarkFeed } from '@/hooks/parcel/use-marks';
import { company, usePreIpoAssets } from '@/hooks/parcel/use-preipo';
import { PUBLIC_EQUITIES } from '@/lib/parcel/public-equities';
import type { ProviderQuote } from '@/lib/preipo/types';
import { AssetLogo } from './AssetLogo';
import { Empty } from './shared';
import { compact, pct, usd } from './shared';

const STORAGE_KEY = 'parcel.watchlist.v2';
const LEGACY_STORAGE_KEY = 'parcel.watchlist.prestocks.v1';

type Scope = 'all' | 'equities' | 'prestocks';
type WatchId = `equity:${string}` | `prestocks:${string}`;
type Equity = (typeof PUBLIC_EQUITIES)[number];
interface WatchPreference {
  /** null follows the changing catalog, minus explicit exclusions. */
  included: WatchId[] | null;
  excluded: WatchId[];
}

const equityId = (symbol: string): WatchId => `equity:${symbol}`;
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

const matchesEquity = (equity: Equity, query: string) =>
  `${equity.name} ${equity.symbol}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());

const sourceLabel = (mark: Mark | undefined) => {
  if (!mark) return 'Awaiting mark';
  return mark.source === 'simulated' ? 'Modeled fallback' : 'Pyth live';
};

const sourceDetail = (mark: Mark | undefined) => {
  if (!mark) return '—';
  return mark.source === 'simulated' ? 'Modeled' : 'Pyth';
};

const asWatchIds = (values: unknown[]): WatchId[] =>
  values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    if (value.startsWith('equity:') || value.startsWith('prestocks:'))
      return [value as WatchId];
    // Watchlists saved before public equities were added held raw mints.
    return [prestocksId(value)];
  });

const readSaved = (): WatchPreference | null => {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY) ??
        'null',
    );
    if (Array.isArray(parsed))
      return { included: asWatchIds(parsed), excluded: [] };
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    return {
      included: Array.isArray(record.included)
        ? asWatchIds(record.included)
        : null,
      excluded: Array.isArray(record.excluded)
        ? asWatchIds(record.excluded)
        : [],
    };
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

function EquityIdentity({ equity, mark }: { equity: Equity; mark?: Mark }) {
  return (
    <div className="od-watchlist-company">
      <AssetLogo symbol={equity.symbol} size={34} />
      <div>
        <b>{equity.name}</b>
        <small>
          {equity.symbol} · Public equity · {sourceLabel(mark)}
        </small>
      </div>
    </div>
  );
}

function Price({ value }: { value: number | null | undefined }) {
  return <b>{value == null ? '—' : usd(value)}</b>;
}

function RemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="od-watchlist-actions">
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} from watchlist`}
        title="Remove from watchlist"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function EquityRow({
  equity,
  mark,
  onRemove,
}: {
  equity: Equity;
  mark?: Mark;
  onRemove: () => void;
}) {
  return (
    <article className="od-watchlist-row od-watchlist-equity-row">
      <EquityIdentity equity={equity} mark={mark} />
      <div className="od-watchlist-metric">
        <span>Last</span>
        <Price value={mark?.price} />
      </div>
      <div className="od-watchlist-metric">
        <span>Day</span>
        <b
          className={
            mark && mark.change !== 0
              ? mark.change > 0
                ? 'od-up'
                : 'od-down'
              : ''
          }
        >
          {mark ? pct(mark.change) : '—'}
        </b>
      </div>
      <div className="od-watchlist-metric od-watchlist-source-cell">
        <span>Source</span>
        <b>{sourceDetail(mark)}</b>
      </div>
      <RemoveButton label={equity.name} onRemove={onRemove} />
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

function EquityResult({
  equity,
  onAdd,
}: {
  equity: Equity;
  onAdd: () => void;
}) {
  return (
    <article className="od-watchlist-result">
      <EquityIdentity equity={equity} />
      <div>
        <span>Universe</span>
        <b>Public equity</b>
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
 * A reader-controlled watchlist across two truthfully distinct sources.
 *
 * Public equities use the desk's live-mark pipeline and identify a modeled
 * fallback per row. PreStocks remains a publisher quote sheet: its token and
 * valuation fields are shown as published rather than forced into an equity
 * quote convention they do not share.
 */
export function WatchlistView({ feed }: { feed: MarkFeed }) {
  const { data, error } = usePreIpoAssets();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [preference, setPreference] = useState<WatchPreference | null>(
    readSaved,
  );

  const catalog = useMemo(
    () =>
      [...(data?.catalog ?? [])].sort((a, b) =>
        company(a.displayName).localeCompare(company(b.displayName)),
      ),
    [data],
  );
  const allIds = useMemo<WatchId[]>(
    () => [
      ...PUBLIC_EQUITIES.map((equity) => equityId(equity.symbol)),
      ...catalog.map((quote) => prestocksId(quote.mint)),
    ],
    [catalog],
  );

  useEffect(() => {
    if (preference !== null)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  }, [preference]);

  const savedIds = preference
    ? (preference.included ??
      allIds.filter((id) => !preference.excluded.includes(id)))
    : allIds;
  const selected = new Set(savedIds);
  const showEquities = scope !== 'prestocks';
  const showPreStocks = scope !== 'equities';
  const watchedEquities = savedIds
    .filter((id) => id.startsWith('equity:'))
    .map((id) =>
      PUBLIC_EQUITIES.find((equity) => equityId(equity.symbol) === id),
    )
    .filter((equity): equity is Equity => Boolean(equity))
    .filter((equity) => matchesEquity(equity, query));
  const watchedPreStocks = savedIds
    .filter((id) => id.startsWith('prestocks:'))
    .map((id) => catalog.find((quote) => prestocksId(quote.mint) === id))
    .filter((quote): quote is ProviderQuote => Boolean(quote))
    .filter((quote) => matchesPreStocks(quote, query));
  const equityAdditions = PUBLIC_EQUITIES.filter(
    (equity) =>
      !selected.has(equityId(equity.symbol)) &&
      query.trim() &&
      matchesEquity(equity, query),
  );
  const preStocksAdditions = catalog.filter(
    (quote) =>
      !selected.has(prestocksId(quote.mint)) &&
      query.trim() &&
      matchesPreStocks(quote, query),
  );
  const refreshed = data
    ? new Date(data.refreshedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      })
    : null;
  const remove = (id: WatchId) =>
    setPreference((current) => {
      const next = current ?? { included: null, excluded: [] };
      if (next.included === null)
        return next.excluded.includes(id)
          ? next
          : { ...next, excluded: [...next.excluded, id] };
      return { ...next, included: next.included.filter((item) => item !== id) };
    });
  const add = (id: WatchId) =>
    setPreference((current) => {
      const next = current ?? { included: null, excluded: [] };
      if (next.included === null)
        return {
          ...next,
          excluded: next.excluded.filter((item) => item !== id),
        };
      return next.included.includes(id)
        ? next
        : { ...next, included: [...next.included, id] };
    });
  const sourceLive = PUBLIC_EQUITIES.filter(
    (equity) => feed.marks[equity.symbol]?.source === 'pyth',
  ).length;
  const totalListed = PUBLIC_EQUITIES.length + catalog.length;

  return (
    <section className="od-watchlist" aria-labelledby="watchlist-title">
      <header className="od-watchlist-head">
        <div>
          <span className="od-watchlist-kicker">Portfolio</span>
          <h2 id="watchlist-title">Watchlist</h2>
          <p>
            Public equities and current publisher marks for the instruments you
            follow.
          </p>
        </div>
        <div className="od-watchlist-source">
          <b>Equities + PreStocks</b>
          <span>
            {PUBLIC_EQUITIES.length} public · {catalog.length} PreStocks
            {refreshed ? ` · publisher updated ${refreshed} UTC` : ''}
          </span>
        </div>
      </header>

      <div className="od-watchlist-toolbar">
        <label className="od-watchlist-search">
          <Search size={16} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search public equities and PreStocks"
            aria-label="Search public equities and PreStocks"
          />
          <span>{totalListed} instruments</span>
        </label>
        <div
          className="od-watchlist-filter"
          role="tablist"
          aria-label="Watchlist sources"
        >
          {(
            [
              ['all', 'All'],
              ['equities', 'Equities'],
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

      {(equityAdditions.length > 0 || preStocksAdditions.length > 0) && (
        <section className="od-watchlist-results" aria-label="Add to watchlist">
          <div className="od-watchlist-results-head">
            <span>Catalog matches</span>
            <small>Add an instrument to this browser’s watchlist.</small>
          </div>
          {equityAdditions.map((equity) => (
            <EquityResult
              key={equity.symbol}
              equity={equity}
              onAdd={() => add(equityId(equity.symbol))}
            />
          ))}
          {preStocksAdditions.map((quote) => (
            <PreStocksResult
              key={quote.mint}
              quote={quote}
              onAdd={() => add(prestocksId(quote.mint))}
            />
          ))}
        </section>
      )}

      {showEquities && (
        <section
          className="od-watchlist-section"
          aria-labelledby="watchlist-equities"
        >
          <SectionHead
            id="watchlist-equities"
            title="Public equities"
            detail={
              feed.ready
                ? `${sourceLive} Pyth live · modeled fallback is labeled`
                : 'Connecting to price sources'
            }
          />
          <div className="od-watchlist-table od-watchlist-equities">
            <div className="od-watchlist-labels" aria-hidden="true">
              <span>Instrument</span>
              <span>Last</span>
              <span>Day</span>
              <span>Source</span>
              <span />
            </div>
            {watchedEquities.length ? (
              watchedEquities.map((equity) => (
                <EquityRow
                  key={equity.symbol}
                  equity={equity}
                  mark={feed.marks[equity.symbol]}
                  onRemove={() => remove(equityId(equity.symbol))}
                />
              ))
            ) : (
              <Empty
                title={
                  query
                    ? 'No watched equities match'
                    : 'No public equities watched'
                }
                description="Search the public-equity universe above to add a symbol."
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
              error
                ? 'Publisher data temporarily unavailable'
                : data
                  ? `${catalog.length} listed · updated ${refreshed} UTC`
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
            {data && watchedPreStocks.length ? (
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
                  error
                    ? 'PreStocks catalog unavailable'
                    : query
                      ? 'No watched PreStocks match'
                      : 'No PreStocks watched'
                }
                description={
                  error
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

      <p className="od-watchlist-note">
        Equity marks come from Pyth when available and otherwise show a labeled
        model fallback. PreStocks mark, token price and valuation are publisher
        data. Neither source settles Parcel contracts.
      </p>
    </section>
  );
}
