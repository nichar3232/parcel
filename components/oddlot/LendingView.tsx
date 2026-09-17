'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, Info, TriangleAlert } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { VaultAction } from '@/lib/oddlot/types';
import { amount } from '@/lib/oddlot/validation';
import { add, mul, round } from '@/lib/oddlot/math';
import {
  accruedInterest,
  termInterest,
  protectionPremium,
  shortCloseAmounts,
} from '@/lib/oddlot/funding';
import {
  RESERVES,
  health,
  healthTone,
  liquidationPrice,
  rates,
  reserveOf,
  type Holding,
} from '@/lib/oddlot/lending';
import { AssetLogo } from './AssetLogo';
import { Meter } from './charts';
import { Tape } from './Tape';
import {
  Badge,
  Button,
  Empty,
  Field,
  Line,
  Modal,
  Money,
  Panel,
  PanelHead,
  Segmented,
  Stat,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type LendingTab = 'markets' | 'borrow' | 'positions';

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function LendingView({
  desk,
  feed,
  tab,
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: LendingTab;
}) {
  const s = desk.state!;

  /**
   * The desk's own position, expressed in money-market terms.
   *
   * Vault assets are collateral; shares sold short are the debt. It is
   * the same book the rest of the product shows, read through the
   * lending model so one health factor covers all of it.
   */
  const position = useMemo(() => {
    const price = (symbol: string) =>
      feed.marks[symbol]?.price ?? (symbol === 'NVDA' ? s.market.price : 1);
    const collateral: Holding[] = [
      { symbol: 'USDC', amount: s.book.vault.USDC, price: price('USDC') },
      { symbol: 'NVDA', amount: s.book.vault.NVDA, price: price('NVDA') },
    ].filter((h) => h.amount > 0);
    const shorted = s.book.shorts
      .filter((p) => p.status === 'active')
      .reduce((t, p) => t + p.quantity, 0);
    const debt: Holding[] = shorted
      ? [{ symbol: 'NVDA', amount: shorted, price: price('NVDA') }]
      : [];
    const h = health(collateral, debt);
    const weighted = collateral.reduce((t, c) => {
      const r = reserveOf(c.symbol);
      return t + (r ? c.amount * c.price * r.liquidation : 0);
    }, 0);
    return {
      ...h,
      collateral,
      debt,
      shorted,
      liquidation: liquidationPrice(weighted, shorted),
    };
  }, [s, feed.marks]);

  if (tab === 'borrow')
    return <Borrow desk={desk} feed={feed} position={position} />;
  if (tab === 'positions') return <Positions desk={desk} />;

  return <Markets desk={desk} feed={feed} position={position} />;
}

type Position = ReturnType<typeof usePositionShape>;
// Only for the type; the value is built inline above.
function usePositionShape() {
  return {
    factor: 0,
    supplied: 0,
    owed: 0,
    borrowPower: 0,
    available: 0,
    used: 0,
    collateral: [] as Holding[],
    debt: [] as Holding[],
    shorted: 0,
    liquidation: null as number | null,
  };
}

/* ---------------------------------------------------------------- */

function HealthCard({ position }: { position: Position }) {
  const tone = healthTone(position.factor);
  return (
    <Panel className={`od-health ${tone}`}>
      <div className="od-panel-body">
        <div className="od-health-top">
          <div>
            <span>Health factor</span>
            <strong>
              {Number.isFinite(position.factor)
                ? position.factor.toFixed(2)
                : '∞'}
            </strong>
          </div>
          <Badge tone={tone === 'safe' ? 'green' : tone === 'watch' ? 'warn' : 'red'}>
            {tone === 'safe'
              ? 'Healthy'
              : tone === 'watch'
                ? 'Watch'
                : 'At risk'}
          </Badge>
        </div>
        <Meter
          label="Borrow power used"
          value={position.used}
          of={1}
          note={`${(position.used * 100).toFixed(1)}% of ${usd(position.borrowPower)}`}
          color={
            tone === 'safe'
              ? 'var(--pc-up)'
              : tone === 'watch'
                ? 'var(--pc-warn)'
                : 'var(--pc-down)'
          }
        />
        <div className="od-lines">
          <Line label="Supplied" value={usd(position.supplied)} />
          <Line label="Borrowed" value={usd(position.owed)} />
          <Line
            label="Still available to borrow"
            value={usd(position.available)}
          />
          {position.liquidation != null && position.shorted > 0 && (
            <Line
              label="Short liquidates at"
              value={usd(position.liquidation)}
              tone="down"
            />
          )}
        </div>
        <p className="od-note">
          <Info size={13} />
          Liquidation begins below 1.00. Every reserve carries its own
          threshold, so the factor moves with what you hold, not only with how
          much you owe.
        </p>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- */

function Markets({
  desk,
  feed,
  position,
}: {
  desk: VaultController;
  feed: MarkFeed;
  position: Position;
}) {
  const s = desk.state!;
  const rows = RESERVES.map((r) => {
    const mark = feed.marks[r.symbol];
    const u = mark?.utilisation ?? 0.5;
    const price =
      mark?.price ?? (r.symbol === 'NVDA' ? s.market.price : 1);
    return { reserve: r, mark, price, ...rates(u, r) };
  });

  const held = (symbol: string) =>
    symbol === 'NVDA'
      ? s.book.vault.NVDA
      : symbol === 'USDC'
        ? s.book.vault.USDC
        : 0;

  return (
    <>
      <div className="od-grid-4">
        <Panel>
          <Stat
            label="Your supplies"
            value={<Money value={position.supplied} />}
            detail={`${position.collateral.length} assets in the vault`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Your borrows"
            value={<Money value={position.owed} />}
            detail={
              position.shorted
                ? `${qty(position.shorted)} NVDA sold short`
                : 'Nothing borrowed'
            }
          />
        </Panel>
        <Panel>
          <Stat
            label="Available to borrow"
            value={<Money value={position.available} />}
            detail="At each reserve's loan-to-value"
          />
        </Panel>
        <Panel>
          <Stat
            label="Total market size"
            value={
              <Money
                value={rows.reduce(
                  (t, r) => t + (r.mark?.supplied ?? 0) * r.price,
                  0,
                )}
                decimals={0}
              />
            }
            detail="Across every reserve"
          />
        </Panel>
      </div>

      <div className="od-work od-lend-work">
        <HealthCard position={position} />

        <div className="od-insight">
          <Panel>
            <PanelHead
              title="Reserves"
              description="Rates come from each pool's utilisation, on the same two-slope curve the major money markets use."
              action={
                <Badge tone={feed.connected ? 'green' : 'neutral'}>
                  {feed.connected ? 'Live' : 'Simulated'}
                </Badge>
              }
            />
            <div className="od-table-wrap">
              <table className="od-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Price</th>
                    <th className="num">Supply APY</th>
                    <th className="num">Borrow APY</th>
                    <th className="num">Utilisation</th>
                    <th className="num">Max LTV</th>
                    <th className="num">Liquidation</th>
                    <th className="num">You hold</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ reserve: r, price, supply, borrow, utilisation }) => (
                    <tr key={r.symbol} title={r.note}>
                      <td>
                        <div className="od-asset-cell">
                          <AssetLogo symbol={r.symbol} size={30} />
                          <div>
                            <b>{r.symbol}</b>
                            <small>{r.name}</small>
                          </div>
                        </div>
                      </td>
                      <td className="num">{usd(price, price < 10 ? 4 : 2)}</td>
                      <td className="num od-up">{pct(supply)}</td>
                      <td className="num od-down">{pct(borrow)}</td>
                      <td className="num">
                        <span className="od-util">
                          <i
                            aria-hidden
                            style={{ width: `${utilisation * 100}%` }}
                          />
                          {(utilisation * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="num">{(r.ltv * 100).toFixed(0)}%</td>
                      <td className="num">{(r.liquidation * 100).toFixed(0)}%</td>
                      <td className="num">
                        {held(r.symbol) ? qty(held(r.symbol)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="od-panel-foot">
              <span>
                Cash supplied here is routed to the deepest Solana money
                markets. Only NVDA lending, protected shorts and spot are
                executed by this build.
              </span>
            </div>
          </Panel>
        </div>
      </div>

      <Tape
        feed={feed}
        title="Pool activity"
        description="The maker minting and burning against every reserve, which is what moves utilisation and therefore the rates above."
        symbols={RESERVES.map((r) => r.symbol)}
      />
    </>
  );
}

/* ---------------------------------------------------------------- */

function Borrow({
  desk,
  feed,
  position,
}: {
  desk: VaultController;
  feed: MarkFeed;
  position: Position;
}) {
  const s = desk.state!;
  const future = s.market.dates.filter((d) => d > s.book.date);
  const defaultExpiry =
    future.find((d) => d >= '2025-02-07') || future[0] || s.book.date;

  const [mode, setMode] = useState<'short' | 'lend' | 'stock'>('short');
  const [quantity, setQuantity] = useState('1');
  const [cap, setCap] = useState(String(Math.ceil(s.market.price * 1.12)));
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [review, setReview] = useState<{
    action: VaultAction;
    revision: number;
    title: string;
    label: string;
    value: number;
    details: [string, string][];
  } | null>(null);

  const end = expiry > s.book.date ? expiry : defaultExpiry;
  const q = Number(quantity);
  const k = Number(cap);

  let valid = mode === 'stock' || future.length > 0;
  try {
    amount(q);
    if (mode === 'short') {
      amount(k, 0.000001, Math.min(10000, s.market.price * 2));
      if (k <= s.market.price) valid = false;
    }
  } catch {
    valid = false;
  }

  const interest = valid ? termInterest(q, s.market.price, s.book.date, end) : 0;
  const protection =
    valid && mode === 'short'
      ? protectionPremium(q, s.market.price, k, s.book.date, end)
      : 0;

  // What this borrow would do to the health factor, before it is taken.
  const projected = (() => {
    if (mode !== 'short' || !valid) return null;
    const price = feed.marks.NVDA?.price ?? s.market.price;
    const weighted = position.collateral.reduce((t, c) => {
      const r = reserveOf(c.symbol);
      return t + (r ? c.amount * c.price * r.liquidation : 0);
    }, 0);
    const owed = position.owed + q * price;
    return {
      factor: owed > 0 ? weighted / owed : Infinity,
      liquidation: liquidationPrice(weighted, position.shorted + q),
      owed,
    };
  })();

  const nvdaRates = rates(
    feed.marks.NVDA?.utilisation ?? 0.5,
    reserveOf('NVDA')!,
  );

  const openReview = () =>
    setReview({
      action:
        mode === 'lend'
          ? { type: 'lend', quantity: q, expiry: end }
          : mode === 'short'
            ? { type: 'short', quantity: q, cap: k, expiry: end }
            : { type: 'stock', side, quantity: q },
      revision: s.revision,
      title:
        mode === 'lend'
          ? 'Fund this stock loan?'
          : mode === 'short'
            ? 'Open this protected short?'
            : 'Confirm stock exchange',
      label:
        mode === 'lend'
          ? 'Borrower posts cash'
          : mode === 'short'
            ? 'Maximum cash reserved'
            : 'Total consideration',
      details:
        mode === 'stock'
          ? [
              ['Direction', side === 'buy' ? 'Buy owned stock' : 'Sell owned stock'],
              ['Settlement', 'Immediate stock and USDC exchange'],
            ]
          : [
              ['Term ends', expiryLabel(end)],
              ['Borrow rate', '3.50% APR'],
              ['Full-term interest', usd(interest, 6)],
              ['Stock sale proceeds', usd(mul(q, s.market.price), 6)],
              [
                'Protective call',
                `Buy ${qty(q)} NVDA call at ${usd(mode === 'lend' ? round(s.market.price * 1.5) : k, 2)}`,
              ],
              [
                `Protection premium paid by ${mode === 'lend' ? 'the borrower' : 'you'}`,
                usd(
                  mode === 'lend'
                    ? protectionPremium(
                        q,
                        s.market.price,
                        round(s.market.price * 1.5),
                        s.book.date,
                        end,
                      )
                    : protection,
                  6,
                ),
              ],
              [
                'Your cash movement now',
                mode === 'lend'
                  ? '$0.000000'
                  : usd(add(mul(q, s.market.price), -protection), 6),
              ],
            ],
      value:
        mode === 'lend'
          ? add(mul(q, round(s.market.price * 1.5)), interest)
          : mode === 'short'
            ? add(mul(q, k), interest)
            : mul(q, s.market.price),
    });

  const confirm = async () => {
    if (review && (await desk.act(review.action, review.revision)))
      setReview(null);
  };

  return (
    <div className="od-work od-lend-work">
      <Panel className="od-ticket">
        <PanelHead
          title="Borrow and short"
          action={<Badge tone="accent">NVDA</Badge>}
        />
        <div className="od-panel-body">
          <Segmented
            label="What to do"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'short', label: 'Short' },
              { id: 'lend', label: 'Lend' },
              { id: 'stock', label: 'Spot' },
            ]}
          />

          <p className="od-note">
            {mode === 'short'
              ? 'Borrow the stock against your vault, sell it, and buy a call that caps what the repurchase can cost. The cap is what makes the maximum loss knowable before you open.'
              : mode === 'lend'
                ? 'Lend unpledged shares. The borrower posts cash collateral and the whole term’s interest up front, and cannot reuse the protection they pledged.'
                : 'Buy or sell stock outright against the vault, fully funded either way.'}
          </p>

          <Field
            label="Shares"
            hint={`Available ${qty(s.risk.freeShares)} NVDA`}
          >
            <input
              type="number"
              min="0.000001"
              max="1000"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>

          {mode === 'stock' ? (
            <Field label="Direction">
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
              >
                <option value="buy">Buy, fully cash funded</option>
                <option value="sell">Sell, owned shares only</option>
              </select>
            </Field>
          ) : (
            <Field label="Term ends">
              <select value={end} onChange={(e) => setExpiry(e.target.value)}>
                {future.map((d) => (
                  <option key={d} value={d}>
                    {expiryLabel(d)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {mode === 'short' && (
            <div className="od-control">
              <div className="od-control-top">
                <label htmlFor="od-cap">Protective call strike</label>
                <span>
                  {((k / s.market.price - 1) * 100).toFixed(1)}% above spot
                </span>
              </div>
              <input
                id="od-cap"
                aria-label="Protective call strike"
                type="number"
                step="any"
                min={s.market.price + 0.01}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
              <small>
                Caps the stock repurchase price. Full strike cash stays
                reserved.
              </small>
            </div>
          )}

          <div className="od-lines">
            {mode === 'lend' ? (
              <>
                <Line
                  label="Borrower collateral"
                  value={usd(q * s.market.price * 1.5)}
                />
                <Line label="Borrow rate" value="3.50% APR" />
                <Line
                  label="Full-term interest prepaid"
                  value={usd(interest, 4)}
                  tone="up"
                />
              </>
            ) : mode === 'short' ? (
              <>
                <Line
                  label="Stock sale proceeds"
                  value={usd(q * s.market.price)}
                />
                <Line label="Protective call" value={usd(protection)} />
                <Line
                  label="Maximum cash reserved"
                  value={usd(q * k + interest)}
                />
                <Line
                  label="Maximum loss including protection"
                  value={usd(q * (k - s.market.price) + protection + interest)}
                  tone="down"
                />
                <Line
                  label="Pool borrow APY"
                  value={pct(nvdaRates.borrow)}
                  tone="muted"
                />
              </>
            ) : (
              <>
                <Line label="Reference price" value={usd(s.market.price)} />
                <Line
                  label="Total consideration"
                  value={usd(q * s.market.price)}
                />
              </>
            )}
          </div>

          {projected && (
            <div className={`od-projection ${healthTone(projected.factor)}`}>
              <div>
                <span>Health factor after</span>
                <b>
                  {Number.isFinite(projected.factor)
                    ? projected.factor.toFixed(2)
                    : '∞'}
                </b>
              </div>
              {projected.liquidation != null && (
                <div>
                  <span>Liquidates at</span>
                  <b>{usd(projected.liquidation)}</b>
                </div>
              )}
            </div>
          )}

          {projected && projected.factor < 1.25 && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> That leaves very little room. A move
              against you liquidates the position.
            </p>
          )}

          <Button
            size="lg"
            full
            disabled={!valid || desk.busy}
            onClick={openReview}
          >
            Review{' '}
            {mode === 'lend'
              ? 'stock loan'
              : mode === 'short'
                ? 'protected short'
                : 'stock trade'}
            <ArrowRight size={16} />
          </Button>
          <p className="od-note">Pledged protection cannot be reused.</p>
        </div>
      </Panel>

      <div className="od-insight">
        <HealthCard position={position} />

        <Panel>
          <PanelHead
            title="What you can post"
            description="Each reserve's loan-to-value is what decides how much stock you can borrow against it."
          />
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Collateral</th>
                  <th className="num">Max LTV</th>
                  <th className="num">Liquidation at</th>
                  <th className="num">Borrow APY</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {RESERVES.filter((r) => r.collateral).map((r) => {
                  const u = feed.marks[r.symbol]?.utilisation ?? 0.5;
                  return (
                    <tr key={r.symbol}>
                      <td>
                        <div className="od-asset-cell">
                          <AssetLogo symbol={r.symbol} size={28} />
                          <b>{r.symbol}</b>
                        </div>
                      </td>
                      <td className="num">{(r.ltv * 100).toFixed(0)}%</td>
                      <td className="num">{(r.liquidation * 100).toFixed(0)}%</td>
                      <td className="num od-down">{pct(rates(u, r).borrow)}</td>
                      <td>
                        <span className="od-why">{r.note}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {review && (
        <Modal
          title={review.title}
          description={`${qty(q)} NVDA at the ${usd(s.market.price)} stored reference`}
          onClose={() => setReview(null)}
        >
          <div className="od-lines">
            <Line label={review.label} value={usd(review.value, 6)} />
            {review.details.map(([label, value]) => (
              <Line key={label} label={label} value={value} />
            ))}
          </div>
          {review.revision !== s.revision && (
            <p className="od-error" role="alert">
              Your vault changed. Close this review and check the current terms.
            </p>
          )}
          <p className="od-note">
            The transaction either updates every balance and reserve together or
            rolls back entirely. Amounts are validated again by the backend.
          </p>
          <Button
            size="lg"
            full
            disabled={desk.busy || review.revision !== s.revision}
            onClick={() => void confirm()}
          >
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Positions({ desk }: { desk: VaultController }) {
  const s = desk.state!;
  const loans = s.book.loans.filter((p) => p.status === 'active');
  const shorts = s.book.shorts.filter((p) => p.status === 'active');
  const [review, setReview] = useState<{
    action: VaultAction;
    title: string;
    label: string;
    value: number;
    details: [string, string][];
  } | null>(null);

  const confirm = async () => {
    if (review && (await desk.act(review.action, s.revision))) setReview(null);
  };

  return (
    <>
      <Panel>
        <PanelHead
          title="Stock on loan"
          description="Principal stays an owned receivable; the borrower's cash and prepaid interest are held against it."
          action={<Badge tone={loans.length ? 'accent' : 'neutral'}>{loans.length}</Badge>}
        />
        {loans.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Principal</th>
                  <th>Term ends</th>
                  <th className="num">Collateral</th>
                  <th className="num">Interest prepaid</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{qty(p.quantity)} NVDA</b>
                      {p.productive && (
                        <small>
                          Sold at {usd(p.productive.entry)}, protected at{' '}
                          {usd(p.productive.cap)}
                        </small>
                      )}
                    </td>
                    <td>{expiryLabel(p.expiry)}</td>
                    <td className="num">{usd(p.collateral)}</td>
                    <td className="num od-up">{usd(p.prepaidInterest, 4)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={desk.busy}
                        onClick={() =>
                          setReview({
                            action: { type: 'recall', id: p.id },
                            title: 'Review stock recall',
                            label: 'Interest you receive',
                            value: accruedInterest(
                              p.prepaidInterest,
                              p.opened,
                              p.expiry,
                              s.book.date,
                            ),
                            details: [
                              ['Shares returned', `${qty(p.quantity)} NVDA`],
                              [
                                'Unused borrower collateral',
                                'Returned to the borrower after repurchase',
                              ],
                            ],
                          })
                        }
                      >
                        Recall shares
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No shares out on loan"
            description="Lend available stock to receive a collateral-backed claim and prepaid interest."
          />
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="Protected shorts"
          description="Each short pairs the borrow with a call that caps the repurchase cost."
          action={<Badge tone={shorts.length ? 'accent' : 'neutral'}>{shorts.length}</Badge>}
        />
        {shorts.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th className="num">Quantity</th>
                  <th className="num">Entry</th>
                  <th className="num">Protection</th>
                  <th>Term ends</th>
                  <th className="num">Max reserved</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shorts.map((p) => {
                  const close = shortCloseAmounts(p, s.market.price, s.book.date);
                  return (
                    <tr key={p.id}>
                      <td className="num">{qty(p.quantity)}</td>
                      <td className="num">{usd(p.entry)}</td>
                      <td className="num">{usd(p.cap)}</td>
                      <td>{expiryLabel(p.expiry)}</td>
                      <td className="num">
                        {usd(p.quantity * p.cap + p.maxInterest)}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={desk.busy}
                          onClick={() =>
                            setReview({
                              action: { type: 'close-short', id: p.id },
                              title: 'Review short close',
                              label: 'You pay to cover and repay',
                              value: close.total,
                              details: [
                                ['Repurchase cost', usd(close.repurchase, 6)],
                                ['Accrued borrow cost', usd(close.interest, 6)],
                                [
                                  'Total P&L including paid protection',
                                  usd(close.pnl, 6),
                                ],
                                [
                                  'Protective call retired',
                                  `Strike ${usd(p.cap, 2)}, expiry ${expiryLabel(p.expiry)}`,
                                ],
                              ],
                            })
                          }
                        >
                          Cover &amp; repay
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No open stock shorts"
            description="A protective call makes the maximum repayment explicit before the borrow begins."
          />
        )}
      </Panel>

      {review && (
        <Modal
          title={review.title}
          description="Every balance and reserve moves together, or nothing does."
          onClose={() => setReview(null)}
        >
          <div className="od-lines">
            <Line label={review.label} value={usd(review.value, 6)} />
            {review.details.map(([label, value]) => (
              <Line key={label} label={label} value={value} />
            ))}
          </div>
          <Button
            size="lg"
            full
            disabled={desk.busy}
            onClick={() => void confirm()}
          >
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </>
  );
}
