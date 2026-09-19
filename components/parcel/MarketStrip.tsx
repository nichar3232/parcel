'use client';
import { useState } from 'react';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { company, usePreIpoAssets } from '@/hooks/parcel/use-preipo';
import { underlying } from '@/lib/parcel/universe';
import { AssetLogo } from './AssetLogo';
import { Sparkline } from './charts';
import { usd } from './shared';

const KEEP = 60;

/**
 * Every mark the feed has published this session, per symbol.
 *
 * The feed carries a price and a day change, not a history, and no
 * venue publishes one for a private company. So the strip remembers
 * what it has seen: the line starts the moment the page opens and
 * grows with the session. NVDA has stored closes and draws those.
 */
function useSeen(feed: MarkFeed) {
  const [seen, setSeen] = useState<{
    asOf: number;
    runs: Record<string, number[]>;
  }>({
    asOf: -1,
    runs: {},
  });
  // Adjusting state while rendering, the way React documents for state
  // that follows a prop: the marks arrive as props, and the memory of
  // them is a function of what has arrived so far.
  if (seen.asOf !== feed.asOf) {
    const runs = { ...seen.runs };
    for (const m of feed.list) {
      const run = runs[m.symbol] ?? [];
      if (run.at(-1) !== m.price)
        runs[m.symbol] = [...run, m.price].slice(-KEEP);
    }
    setSeen({ asOf: feed.asOf, runs });
  }
  return seen.runs;
}

/**
 * What you can trade, one row each: the mark, the day, and the line.
 *
 * NVDA first, then the pre-IPO names the registry has verified. A row
 * opens that asset's ticket, so the strip is also how you choose an
 * underlying.
 */
export function MarketStrip({
  feed,
  date,
  onPick,
}: {
  feed: MarkFeed;
  /** The session date, so the NVDA line stops where the desk is. */
  date: string;
  /** Make this the desk's underlying and open the trade ticket on it. */
  onPick: (symbol: string) => void;
}) {
  const { data } = usePreIpoAssets();
  const seen = useSeen(feed);
  const nvda = feed.marks.NVDA;
  // The replay window opens in January, but the stored NVDA source has
  // preceding closes. Use those rather than showing a blank history on
  // day one or pulling future observations into the session.
  const closes = underlying('NVDA')
    .rows.filter((r) => r.date <= date.slice(0, 10))
    .slice(-30)
    .map((r) => r.close);

  return (
    <section className="od-strip" aria-label="Markets">
      <div className="od-strip-head">
        <h2>Markets</h2>
        <span>{feed.connected ? 'Live' : 'Simulated'}</span>
      </div>

      <button
        type="button"
        className="od-strip-row"
        onClick={() => onPick('NVDA')}
      >
        <AssetLogo symbol="NVDA" size={30} />
        <div className="od-strip-what">
          <b>NVIDIA</b>
          <small>NVDA</small>
        </div>
        <div className="od-strip-line">
          <Sparkline values={closes} tone="reference" />
        </div>
        <div className="od-strip-num">
          <b>{nvda ? usd(nvda.price) : '—'}</b>
          {nvda && <Change change={nvda.change} />}
        </div>
      </button>

      {data?.assets.map((a) => {
        const mark = feed.marks[a.asset.symbol];
        const price = mark?.price ?? a.quote?.markPriceUsd ?? null;
        const meta = a.quote?.meta || {};
        const logo =
          typeof meta.image === 'string' ? meta.image : (a.asset.logo ?? null);
        return (
          <button
            key={a.asset.id}
            type="button"
            className="od-strip-row"
            onClick={() => onPick(a.asset.symbol)}
          >
            <AssetLogo
              symbol={company(a.asset.displayName)}
              src={logo}
              size={30}
            />
            <div className="od-strip-what">
              <b>{company(a.asset.displayName)}</b>
              <small>{a.asset.issuerTerms.issuer}</small>
            </div>
            <div className="od-strip-line">
              <Sparkline
                values={seen[a.asset.symbol] ?? []}
                tone="indicative"
              />
            </div>
            <div className="od-strip-num">
              <b>{price != null ? usd(price) : '—'}</b>
              {mark && <Change change={mark.change} />}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function Change({ change }: { change: number }) {
  return (
    <small className={change >= 0 ? 'od-up' : 'od-down'}>
      {change >= 0 ? '+' : ''}
      {(change * 100).toFixed(2)}%
    </small>
  );
}
