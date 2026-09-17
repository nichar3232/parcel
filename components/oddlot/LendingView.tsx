'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, Info, TriangleAlert } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { VaultAction } from '@/lib/oddlot/types';
import { amount } from '@/lib/oddlot/validation';
import { add, mul, round } from '@/lib/oddlot/math';
import {
  termInterest,
  protectionPremium,
} from '@/lib/oddlot/funding';
import {
  health,
  healthTone,
  liquidationPrice,
  reserveOf,
  type Holding,
} from '@/lib/oddlot/lending';
import { Meter } from './charts';
import {
  Badge,
  Button,
  Field,
  Line,
  Modal,
  Panel,
  PanelHead,
  Segmented,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type LendingTab = 'borrow';


export function LendingView({
  desk,
  feed,
}: {
  desk: VaultController;
  feed: MarkFeed;
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

  return <Borrow desk={desk} feed={feed} position={position} />;
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
          <Badge
            tone={tone === 'safe' ? 'green' : tone === 'watch' ? 'warn' : 'red'}
          >
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
        {/* Supplied, borrowed and still-available were printed here as
            well as in the rail directly above, which is the same three
            figures twice on one screen. The only number this card owns
            that nothing else shows is the price the short liquidates
            at. */}
        {position.liquidation != null && position.shorted > 0 && (
          <div className="od-lines">
            <Line
              label="Short liquidates at"
              value={usd(position.liquidation)}
              tone="down"
            />
          </div>
        )}
        <p className="od-note">
          <Info size={13} />
          Liquidation begins below 1.00.
        </p>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- */

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

  const interest = valid
    ? termInterest(q, s.market.price, s.book.date, end)
    : 0;
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
              [
                'Direction',
                side === 'buy' ? 'Buy owned stock' : 'Sell owned stock',
              ],
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
    <div className="od-borrow">
      <HealthCard position={position} />

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
                  label="Maximum loss including protection"
                  value={usd(q * (k - s.market.price) + protection + interest)}
                  tone="down"
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

      {/* A five-column reference table with a paragraph of prose in its
          last cell used to sit to the right of the ticket. None of it
          was a decision on this screen: the ticket prices the one asset
          being borrowed. */}

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

