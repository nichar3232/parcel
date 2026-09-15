'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { ChainCatalog } from '@/lib/oddlot/types';
import type { OrderTerms } from '@/lib/oddlot/types';
import { selectableExpiries } from '@/lib/oddlot/market';
import { Button, Field, Panel, dateLabel, qty, usd } from './shared';
export function OptionsChain({
  desk,
  onSelect,
}: {
  desk: VaultController;
  onSelect: (terms: OrderTerms) => void;
}) {
  const state = desk.state!,
    dates = selectableExpiries(state.book.date);
  const [expiry, setExpiry] = useState(
      dates.find((d) => !d.includes('T')) || dates[0] || '',
    ),
    [quantity, setQuantity] = useState('1'),
    [mobileKind, setMobileKind] = useState<'call' | 'put'>('call');
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
        const result = await read.current(effective, Number(quantity));
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
  }, [effective, quantity, state.revision, state.csrf]);
  const current =
    catalog &&
    catalog.revision === state.revision &&
    catalog.expiry === effective &&
    catalog.quantity === Number(quantity);
  const choose = (
    strike: number,
    kind: 'call' | 'put',
    side: 'buy' | 'sell',
  ) => {
    if (!current || !catalog) return;
    onSelect({
      name: `${side === 'buy' ? 'Long' : 'Short'} ${kind} ${strike}`,
      quantity: catalog.quantity,
      expiry: catalog.expiry,
      settlement: 'physical',
      reference: 'stock',
      legs: [{ kind, side, strike, ratio: 1 }],
    });
  };
  const priceLabel = (p: number) =>
    usd(Math.abs(p), Math.abs(p) > 0 && Math.abs(p) < 0.0001 ? 6 : 4);
  return (
    <Panel className="od-chain">
      <div className="od-panel-heading">
        <div>
          <h2>NVDA options chain</h2>
          <p>Choose a strike. Review funding before you trade.</p>
        </div>
        <b>{usd(state.market.price)}</b>
      </div>
      <div className="od-chain-controls od-form-grid">
        <Field label="Chain expiration">
          <select value={effective} onChange={(e) => setExpiry(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {dateLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chain share-equivalents">
          <input
            type="number"
            min=".000001"
            max="1000"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      </div>
      <p className="od-form-note od-chain-note">
        Model premiums for the entire selected size. Buy and write use a
        zero-spread test counterparty. Physical exercise requires separate cash
        or shares. Hourly ticks carry the daily close forward.
      </p>
      {error && (
        <p role="alert" className="od-error">
          {error}
        </p>
      )}
      {loading && (
        <output className="od-chain-note">Loading model chain…</output>
      )}
      {current && (
        <div className="od-table-wrap od-chain-desktop">
          <table className="od-table od-chain-table">
            <thead>
              <tr>
                <th>Calls</th>
                <th>Call funding</th>
                <th>Strike</th>
                <th>Put funding</th>
                <th>Puts</th>
              </tr>
            </thead>
            <tbody>
              {catalog.rows.map((row) => {
                const cell = (kind: 'call' | 'put') => {
                  const c = row.contracts.find((c) => c.kind === kind)!;
                  return (
                    <div className="od-chain-actions">
                      {(['buy', 'sell'] as const).map((side) => (
                        <Button
                          key={side}
                          variant={side === 'buy' ? 'secondary' : 'quiet'}
                          onClick={() => choose(row.strike, kind, side)}
                        >
                          {side === 'buy' ? 'Buy' : 'Write'}{' '}
                          {priceLabel(c[side].premium)}
                        </Button>
                      ))}
                    </div>
                  );
                };
                const call = row.contracts[0],
                  put = row.contracts[1];
                return (
                  <tr
                    key={row.strike}
                    className={
                      Math.abs(row.strike - state.market.price) < 2.5
                        ? 'od-atm'
                        : ''
                    }
                  >
                    <td>{cell('call')}</td>
                    <td>
                      <small>
                        Buy: {usd(call.buy.cash)}
                        <br />
                        Write: {qty(call.sell.shares)} shares
                      </small>
                    </td>
                    <td>
                      <b>{usd(row.strike, 0)}</b>
                    </td>
                    <td>
                      <small>
                        Buy: {qty(put.buy.shares)} shares
                        <br />
                        Write: {usd(put.sell.cash)}
                      </small>
                    </td>
                    <td>{cell('put')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {current && (
        <div className="od-chain-mobile">
          <div className="od-segmented">
            {(['call', 'put'] as const).map((kind) => (
              <button
                key={kind}
                className={mobileKind === kind ? 'selected' : ''}
                onClick={() => setMobileKind(kind)}
              >
                {kind === 'call' ? 'Calls' : 'Puts'}
              </button>
            ))}
          </div>
          {catalog.rows.map((row) => {
            const c = row.contracts.find((c) => c.kind === mobileKind)!;
            return (
              <div
                className={`od-chain-card ${Math.abs(row.strike - state.market.price) < 2.5 ? 'od-atm' : ''}`}
                key={row.strike}
              >
                <div className="od-chain-strike">
                  <strong>{usd(row.strike, 0)}</strong>
                  <span>{mobileKind} strike</span>
                </div>
                <div className="od-chain-card-actions">
                  {(['buy', 'sell'] as const).map((side) => (
                    <div key={side}>
                      <Button
                        variant={side === 'buy' ? 'secondary' : 'quiet'}
                        onClick={() => choose(row.strike, mobileKind, side)}
                      >
                        {side === 'buy' ? 'Buy' : 'Write'}{' '}
                        {priceLabel(c[side].premium)}
                      </Button>
                      <small>
                        +{' '}
                        {c[side].cash
                          ? usd(c[side].cash)
                          : `${qty(c[side].shares)} ${c[side].shares === 1 ? 'share' : 'shares'}`}{' '}
                        backing
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
