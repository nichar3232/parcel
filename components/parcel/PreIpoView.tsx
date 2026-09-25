'use client';
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { company, usePreIpoAssets } from '@/hooks/parcel/use-preipo';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { ResolvedAsset } from '@/lib/preipo/types';
import { AssetLogo } from './AssetLogo';
import { TradeView } from './TradeView';
import { Empty, Panel, compact, usd } from './shared';

const num = (v: unknown) => (typeof v === 'number' ? v : null);

/**
 * Pre-IPO: the market, and options on any company in it.
 *
 * This was two tabs. Market listed the companies with a holders column
 * that was always empty and an "Escrow: Blocked" badge on every row, and
 * Underwrite offered one product — a covered call escrowed on the
 * publisher's mint — which every one of those mints refused, so the tab
 * was a list of reasons it could not be used. The contracts the vault
 * writes on these tokens never touched that escrow; they are the same
 * ledger contracts as on NVDA.
 *
 * So it is one section now. The market lists each company with its
 * price, its bid and ask and its move today; choosing one opens its
 * page: buy or write calls and puts on it, from the same chain and
 * ticket as everything else on the desk.
 */
export function PreIpoView({
  desk,
  feed,
  pick,
  onPick,
  advanced,
  onAdvanced,
}: {
  desk: VaultController;
  feed: MarkFeed;
  /** The company open, by symbol; empty for the market list. */
  pick?: string;
  onPick: (symbol: string) => void;
  advanced: boolean;
  onAdvanced: (on: boolean) => void;
}) {
  const { data, error } = usePreIpoAssets();
  const state = desk.state!;
  const tradable = new Set(
    (state.market.underlyings ?? [])
      .filter((u) => u.provider === 'prestocks')
      .map((u) => u.symbol),
  );

  if (error && !data)
    return (
      <Panel>
        <Empty
          title="Company list unavailable"
          description={`The publisher could not be reached (${error}). It will retry in a minute.`}
        />
      </Panel>
    );
  if (!data)
    return (
      <Panel>
        <Empty
          title="Loading the market"
          description="Reading the latest marks."
        />
      </Panel>
    );

  const rows = data.assets.filter((a) => tradable.has(a.asset.symbol));
  const open = pick ? rows.find((a) => a.asset.symbol === pick) : undefined;

  if (!open)
    return (
      <section className="od-pm" aria-labelledby="pm-title">
        <div className="od-pm-head">
          <h2 id="pm-title">Pre-IPO market</h2>
          <span
            className={`od-pm-live ${data.priceState === 'fresh' ? 'on' : ''}`}
            title={
              data.priceState === 'fresh'
                ? 'Current PreStocks publisher marks. They are not an executable order book.'
                : data.priceState === 'stale'
                  ? 'The publisher is unavailable; retained marks are labelled stale.'
                  : 'No publisher marks are currently available.'
            }
          >
            <i aria-hidden />
            {data.priceState === 'fresh'
              ? 'Publisher marks'
              : data.priceState === 'stale'
                ? 'Publisher marks stale'
                : 'Publisher unavailable'}
          </span>
        </div>
        <div className="od-pm-table">
          <div className="od-pm-row od-pm-cols">
            <span>Company</span>
            <span>Price</span>
            <span>Model bid</span>
            <span>Model ask</span>
            <span>Today</span>
            <span>Valuation</span>
            <span />
          </div>
          {rows.map((a) => (
            <Row
              key={a.asset.id}
              a={a}
              feed={feed}
              onOpen={() => onPick(a.asset.symbol)}
            />
          ))}
        </div>
      </section>
    );

  const meta = open.quote?.meta || {};
  const mark = feed.marks[open.asset.symbol];
  const price =
    mark?.price ??
    state.market.underlyings.find((u) => u.symbol === open.asset.symbol)
      ?.price ??
    open.quote?.markPriceUsd ??
    0;
  const valuation = num(meta.markValuation) ?? num(meta.impliedValuation);
  const url = typeof meta.externalUrl === 'string' ? meta.externalUrl : null;

  return (
    <>
      <header className="od-company">
        <button className="od-company-back" onClick={() => onPick('')}>
          <ArrowLeft size={14} />
          Pre-IPO market
        </button>
        <div className="od-company-id">
          <AssetLogo
            symbol={company(open.asset.displayName)}
            src={typeof meta.image === 'string' ? meta.image : open.asset.logo}
            size={44}
          />
          <div>
            <h1>{company(open.asset.displayName)}</h1>
            <span>
              {open.asset.symbol}
              {valuation ? `, valued at ${compact(valuation)}` : ''}
              {url && (
                <a href={url} target="_blank" rel="noreferrer">
                  Publisher <ExternalLink size={11} />
                </a>
              )}
            </span>
          </div>
          <div className="od-company-price">
            <b>{usd(price)}</b>
            {mark && (
              <span className={mark.change >= 0 ? 'od-up' : 'od-down'}>
                {mark.change >= 0 ? '+' : ''}
                {(mark.change * 100).toFixed(2)}% today
              </span>
            )}
            {mark && (
              <small>
                <span>Bid {usd(mark.bid)}</span>
                <span>Ask {usd(mark.ask)}</span>
              </small>
            )}
          </div>
        </div>
      </header>
      <TradeView
        key={open.asset.symbol}
        desk={desk}
        feed={feed}
        tab="trade"
        choice="call"
        symbol={open.asset.symbol}
        onSymbol={onPick}
        symbols={[...tradable]}
        advanced={advanced}
        onAdvanced={onAdvanced}
      />
    </>
  );
}

function Row({
  a,
  feed,
  onOpen,
}: {
  a: ResolvedAsset;
  feed: MarkFeed;
  onOpen: () => void;
}) {
  const meta = a.quote?.meta || {};
  const logo =
    typeof meta.image === 'string' ? meta.image : (a.asset.logo ?? null);
  const valuation = num(meta.markValuation) ?? num(meta.impliedValuation);
  const mark = feed.marks[a.asset.symbol];
  const price = mark?.price ?? a.quote?.markPriceUsd ?? null;
  const name = company(a.asset.displayName);
  return (
    <button
      className="od-pm-row"
      onClick={onOpen}
      aria-label={`Trade options on ${name}`}
    >
      <span className="od-pm-company">
        <AssetLogo symbol={name} src={logo} size={34} />
        <span>
          <b>{name}</b>
          <small>{a.asset.symbol}</small>
        </span>
      </span>
      <span className="num">{price != null ? usd(price) : '—'}</span>
      <span className="num od-muted">{mark ? usd(mark.bid) : '—'}</span>
      <span className="num od-muted">{mark ? usd(mark.ask) : '—'}</span>
      <span className={`num ${mark && mark.change >= 0 ? 'od-up' : 'od-down'}`}>
        {mark
          ? `${mark.change >= 0 ? '+' : ''}${(mark.change * 100).toFixed(2)}%`
          : '—'}
      </span>
      <span className="num">{valuation ? compact(valuation) : '—'}</span>
      <span className="od-pm-go">
        Options
        <ChevronRight size={14} />
      </span>
    </button>
  );
}
