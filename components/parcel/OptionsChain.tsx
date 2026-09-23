'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { ChainCatalog } from '@/lib/parcel/types';
import type { OrderTerms } from '@/lib/parcel/types';
import { selectableExpiries } from '@/lib/parcel/market';
import { Panel, qty, usd } from './shared';
export function OptionsChain({
  desk,
  quantity,
  side,
  kind,
  expiry,
  symbol,
  onSelect,
}: {
  desk: VaultController;
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
    dates = selectableExpiries(state.book.date);
  const [catalog, setCatalog] = useState<ChainCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const read = useRef(desk.chain);
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
      try {
        const result = await read.current(effective, quantity, symbol);
        if (!cancelled) setCatalog(result);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effective, quantity, symbol, state.revision, state.csrf]);
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
    state.market.underlyings?.find((u) => u.symbol === symbol)?.price ??
    state.market.price;
  const volatility =
    state.market.underlyings?.find((u) => u.symbol === symbol)?.volatility ??
    state.market.volatility;

  /**
   * Open the ladder on the money.
   *
   * Strikes run high to low, so the top of the list is the deepest
   * out-of-the-money contract there is — the one nobody opens a chain
   * to read. The scroller starts with the share price in the middle of
   * the view: as much of what is in the money below it as of what is
   * not above it, and the rest a scroll away in either direction.
   */
  const scroller = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const box = scroller.current,
      at = marker.current;
    if (!box || !at) return;
    box.scrollTop = Math.max(0, at.offsetTop - box.clientHeight / 2);
  }, [catalog, kind, side]);

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
          <div className="od-chain-summary">
            <div>
              <span>Model indication</span>
              <b>
                {side === 'buy' ? 'Buy' : 'Write'} {kind} · {qty(catalog.quantity)} {catalog.symbol}
              </b>
            </div>
            <div className="od-chain-assumptions" aria-label="Pricing assumptions">
              <span>Spot {usd(catalog.spot)}</span>
              <span>{(volatility * 100).toFixed(0)}% IV</span>
              <span>4.00% rate</span>
              <span>Per selected size</span>
            </div>
          </div>
          <p className="od-chain-guidance">
            Select a premium to open the position simulator. Premiums are Black–Scholes model indications, not executable market quotes.
          </p>
          <div className="od-table-wrap od-ladder-scroll" ref={scroller}>
            <table className="od-table od-ladder">
            <thead>
              <tr>
                <th>Strike</th>
                <th className="num od-ladder-breakeven">Break-even</th>
                <th className="num">Move to B/E</th>
                <th className="num">
                  {side === 'buy' ? 'At exercise' : 'Max reserve'}
                </th>
                <th className="num">Model premium</th>
              </tr>
            </thead>
            <tbody>
              {/* Highest strike first, the way a ladder is read, with
                  the spot marked where it actually falls between two
                  of them. */}
              {[...catalog.rows]
                .sort((a, b) => b.strike - a.strike)
                .map((row, i, all) => {
                  const c = row.contracts.find((c) => c.kind === kind)!;
                  const per = c[side].premium / catalog.quantity;
                  const breakeven =
                    kind === 'call' ? row.strike + per : row.strike - per;
                  const away = (breakeven / spot - 1) * 100;
                  const next = all[i + 1];
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
                        <td className="num od-ladder-breakeven">{usd(breakeven)}</td>
                        <td
                          className={`num od-ladder-distance ${
                            away >= 0 ? 'above' : 'below'
                          }`}
                        >
                          {away >= 0 ? '+' : ''}
                          {away.toFixed(2)}%
                        </td>
                        <td className="num od-muted">
                          {c[side].cash > 0
                            ? usd(c[side].cash)
                            : c[side].shares > 0
                              ? `${qty(c[side].shares)} ${symbol}`
                              : '—'}
                        </td>
                        <td className="num">
                          <button
                            type="button"
                            className="od-ladder-quote"
                            aria-label={`Select ${side} ${kind} at ${usd(
                              row.strike,
                            )}; model premium ${priceLabel(c[side].premium)}`}
                            onClick={() => choose(row.strike, kind, side)}
                          >
                            {priceLabel(c[side].premium)}
                          </button>
                        </td>
                      </tr>
                      {crosses && (
                        <tr className="od-ladder-spot" ref={marker}>
                          <td colSpan={5}>
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
        </>
      )}
    </Panel>
  );
}
