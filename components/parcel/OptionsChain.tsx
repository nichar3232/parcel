'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { ChainCatalog } from '@/lib/parcel/types';
import type { OrderTerms } from '@/lib/parcel/types';
import { offeredExpiries } from '@/lib/parcel/market';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { Panel, qty, usd } from './shared';
export function OptionsChain({
  desk,
  feed,
  quantity,
  side,
  kind,
  expiry,
  symbol,
  onSelect,
}: {
  desk: VaultController;
  /** The same-origin mark stream; used to reprice on a real observation. */
  feed?: MarkFeed;
  /** The underlying the ladder is priced on. */
  symbol: string;
  /**
   * The size to price the ladder at, owned by the ticket beside it.
   *
   * The chain had its own size box, which meant two fields for one
   * number: you could scan a ladder priced for one share and then
   * place a different size without the premiums you read ever
   * applying.
   */
  quantity: number;
  /**
   * Which ladder to read, chosen on the screen's top line.
   *
   * The controls live up there with the screen's other controls rather
   * than inside the panel they steer, so the reader sets what they are
   * looking at before they start looking.
   */
  side: 'buy' | 'sell';
  kind: 'call' | 'put';
  expiry: string;
  onSelect: (terms: OrderTerms) => void;
}) {
  const state = desk.state!,
    dates = offeredExpiries(state.market, state.book.date);
  const [catalog, setCatalog] = useState<ChainCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  // A ladder is a decision surface, not a complete strike archive. Start
  // with a deliberate window around spot and let readers expand it only
  // when they need farther wings.
  const [expandedRows, setExpandedRows] = useState({
    listing: '',
    count: 11,
  });
  const read = useRef(desk.chain);
  // A slower request can finish after an event-driven reprice. Only the
  // newest request may update the ladder, otherwise the UI can briefly show
  // an older spot after a fresh NBBO event has already arrived.
  const requestVersion = useRef(0);
  useLayoutEffect(() => {
    read.current = desk.chain;
  }, [desk.chain]);
  const effective = dates.includes(expiry) ? expiry : dates[0] || '';
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      setCatalog(null);
      const version = ++requestVersion.current;
      try {
        const result = await read.current(effective, quantity, symbol);
        if (!cancelled && version === requestVersion.current) {
          setCatalog(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled && version === requestVersion.current)
          setError((e as Error).message);
      } finally {
        if (!cancelled && version === requestVersion.current) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effective, quantity, symbol, state.revision, state.csrf]);
  /* On the live market the ladder re-prices in place every two seconds:
     the same request, answered at the current mark, swapped in without
     clearing the table, so the premiums tick rather than flash. */
  const live = state.market.clock === 'live';

  // `asOf` changes for regular sandbox ticks too. Key the fast reprice to
  // this instrument's provider timestamp instead, so a live options ladder
  // follows the actual upstream event without firing for an unrelated mark
  // or an invented walk. The two-second interval below remains a recovery
  // path for proxies and non-streaming sources.
  const observedAt =
    live && !feed?.marks[symbol]?.stale
      ? (feed?.marks[symbol]?.observedAt ?? 0)
      : 0;

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const version = ++requestVersion.current;
      try {
        const result = await read.current(effective, quantity, symbol);
        if (!cancelled && version === requestVersion.current) {
          setCatalog(result);
          setLoading(false);
        }
      } catch {
        /* keep the last good ladder; the next tick tries again */
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, effective, quantity, symbol, state.revision]);

  useEffect(() => {
    if (!live || !observedAt) return;
    let cancelled = false;
    // Coalesce a burst of venue events into one request. The mark stream
    // itself already preserves the newest complete book at a ten-Hz browser
    // cadence; this short delay avoids issuing one chain request per packet.
    const timer = setTimeout(async () => {
      const version = ++requestVersion.current;
      try {
        const result = await read.current(effective, quantity, symbol);
        if (!cancelled && version === requestVersion.current) {
          setCatalog(result);
          setLoading(false);
        }
      } catch {
        /* Retain the last complete model ladder until the next mark. */
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, observedAt, effective, quantity, symbol]);
  const current =
    catalog &&
    catalog.revision === state.revision &&
    catalog.expiry === effective &&
    catalog.quantity === quantity;
  const choose = (
    strike: number,
    kind: 'call' | 'put',
    side: 'buy' | 'sell',
  ) => {
    if (!current || !catalog) return;
    onSelect({
      symbol: catalog.symbol,
      name: `${side === 'buy' ? 'Long' : 'Short'} ${kind} ${strike}`,
      quantity: catalog.quantity,
      expiry: catalog.expiry,
      settlement: 'physical',
      reference: 'stock',
      legs: [{ kind, side, strike, ratio: 1 }],
    });
  };
  // Chain premiums read at two decimals. A non-zero premium must never
  // render as $0.00, so anything that would round to zero is marked as
  // below a cent rather than shown as free.
  const chainPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const priceLabel = (p: number) => {
    const v = Math.abs(p);
    return v > 0 && v < 0.005 ? '<$0.01' : chainPrice.format(v);
  };
  const spot =
    catalog?.spot ??
    state.market.underlyings?.find((u) => u.symbol === symbol)?.price ??
    state.market.price;
  const volatility =
    state.market.underlyings?.find((u) => u.symbol === symbol)?.volatility ??
    state.market.volatility;

  // An expanded window belongs to one instrument / expiry / selected size.
  // A changed ladder gets its compact window immediately; live reprices keep
  // the reader's intentional expansion without an effect-induced flash.
  const listing = catalog
    ? `${catalog.expiry}|${catalog.symbol}|${catalog.quantity}|${kind}|${side}`
    : '';
  const visibleRows =
    expandedRows.listing === listing ? expandedRows.count : 11;

  const orderedRows = catalog
    ? [...catalog.rows].sort((a, b) => b.strike - a.strike)
    : [];
  const nearest = orderedRows.reduce(
    (closest, row, index) =>
      Math.abs(row.strike - spot) < Math.abs(orderedRows[closest].strike - spot)
        ? index
        : closest,
    0,
  );
  const start = Math.max(
    0,
    Math.min(
      orderedRows.length - visibleRows,
      nearest - Math.floor((visibleRows - 1) / 2),
    ),
  );
  const rows = orderedRows.slice(start, start + visibleRows);
  const hasMoreRows = rows.length < orderedRows.length;

  return (
    <Panel className="od-chain">
      {error && (
        <p role="alert" className="od-error">
          {error}
        </p>
      )}
      {loading && (
        <output className="od-chain-note">Loading model chain…</output>
      )}

      {current && catalog && (
        <>
          <header className="od-chain-head">
            <div className="od-chain-lead">
              <span>Model bid / ask</span>
              <b>
                {side === 'buy' ? 'Buy' : 'Write'} {kind} ·{' '}
                {qty(catalog.quantity)} {catalog.symbol}
              </b>
            </div>
            <ul
              className="od-chain-assumptions"
              aria-label="Pricing assumptions"
            >
              <li>Spot {usd(catalog.spot)}</li>
              <li>{(volatility * 100).toFixed(0)}% IV</li>
              <li>4.00% assumed rate</li>
              <li>Per selected size</li>
              <li
                title="Modelled share-equivalents displayed at the touch — not exchange options volume"
              >
                Model size {qty(catalog.displayedSize)}
              </li>
            </ul>
            <p className="od-chain-guidance">
              Select a premium to open the position simulator. Premiums include
              modelled per-leg spread and size impact; they are not external
              options-market quotes. Model size is displayed depth at the
              touch, not venue volume.
            </p>
          </header>
          <div className="od-table-wrap od-ladder-scroll od-ladder-window">
            <table className="od-table od-ladder">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th className="num od-ladder-breakeven">Break-even</th>
                  <th className="num">Move to B/E</th>
                  <th
                    className="num od-ladder-size"
                    title="Modelled share-equivalents displayed at the touch — not exchange options volume"
                  >
                    Model size
                  </th>
                  <th className="num">Model bid</th>
                  <th className="num">Model ask</th>
                </tr>
              </thead>
              <tbody>
                {/* Highest strike first, the way a ladder is read, with
                  the spot marked where it actually falls between two
                  of them. */}
                {rows.map((row, i) => {
                  const c = row.contracts.find((c) => c.kind === kind)!;
                  // Buy and write prices have opposite cash signs. Break-even
                  // uses the absolute debit/credit in either direction: a
                  // short call breaks even above its strike, never below it.
                  const per = Math.abs(c[side].premium) / catalog.quantity;
                  const breakeven =
                    kind === 'call' ? row.strike + per : row.strike - per;
                  const away = (breakeven / spot - 1) * 100;
                  const next = rows[i + 1];
                  const crosses =
                    row.strike >= spot && (!next || next.strike < spot);
                  return (
                    <Fragment key={row.strike}>
                      <tr>
                        <td>
                          {/* Half-steps are real strikes, so they keep
                              their cents; whole ones do not carry two
                              zeros for the sake of it. */}
                          <b>{usd(row.strike, row.strike % 1 === 0 ? 0 : 2)}</b>
                        </td>
                        <td className="num od-ladder-breakeven">
                          {usd(breakeven)}
                        </td>
                        <td
                          className={`num od-ladder-distance ${
                            away >= 0 ? 'above' : 'below'
                          }`}
                        >
                          {away >= 0 ? '+' : ''}
                          {away.toFixed(2)}%
                        </td>
                        <td
                          className="num od-ladder-size"
                          title="Modelled share-equivalents displayed at the touch — not exchange options volume"
                        >
                          {qty(catalog.displayedSize)}
                        </td>
                        {(['sell', 'buy'] as const).map((at) => {
                          const price = Math.abs(c[at].premium);
                          const label = priceLabel(price);
                          return (
                            <td key={at} className="num">
                              {at === side ? (
                                <button
                                  type="button"
                                  className="od-ladder-quote"
                                  aria-label={`${side === 'buy' ? 'Buy' : 'Write'} ${kind} at ${usd(
                                    row.strike,
                                  )} for ${label}`}
                                  onClick={() => choose(row.strike, kind, side)}
                                >
                                  {label}
                                </button>
                              ) : (
                                <span className="od-ladder-other">{label}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {crosses && (
                        <tr className="od-ladder-spot">
                          <td colSpan={6}>
                            <b>Reference {usd(spot)}</b>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMoreRows && (
            <div className="od-ladder-more">
              <span>
                Showing {rows.length} strikes nearest the reference price
              </span>
              <button
                type="button"
                onClick={() =>
                  setExpandedRows({
                    listing,
                    count: Math.min(orderedRows.length, visibleRows + 6),
                  })
                }
              >
                Show 6 more
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
