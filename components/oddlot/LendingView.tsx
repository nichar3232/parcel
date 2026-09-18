'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { VaultAction } from '@/lib/oddlot/types';
import { amount } from '@/lib/oddlot/validation';
import { add, mul, round } from '@/lib/oddlot/math';
import { termInterest, protectionPremium } from '@/lib/oddlot/funding';
import {
  health,
  liquidationPrice,
  rates,
  reserveOf,
  type Holding,
} from '@/lib/oddlot/lending';
import { selectableExpiries } from '@/lib/oddlot/market';
import { RateCurve } from './charts';
import {
  Badge,
  Button,
  Field,
  Line,
  Modal,
  Panel,
  PanelHead,
  Stat,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type LendingTab = 'borrow';
type Mode = 'short' | 'lend' | 'stock';
const MODES: Mode[] = ['short', 'lend', 'stock'];

export function LendingView({
  desk,
  feed,
  mode,
}: {
  desk: VaultController;
  feed: MarkFeed;
  /** Short, lend or spot — chosen in the rail. */
  mode: string;
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

  return (
    <Borrow
      desk={desk}
      feed={feed}
      position={position}
      mode={MODES.includes(mode as Mode) ? (mode as Mode) : 'short'}
    />
  );
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

function Borrow({
  desk,
  feed,
  position,
  mode,
}: {
  desk: VaultController;
  feed: MarkFeed;
  position: Position;
  mode: Mode;
}) {
  const s = desk.state!;
  // Daily closes only. The date list also carries the test clock's
  // hourly ticks, and a loan that ends an hour from now is not a term
  // anyone means to pick. Default to the first close at least two
  // weeks out, so the figures describe a loan rather than an afternoon.
  const future = selectableExpiries(s.book.date);
  const fortnight = new Date(Date.parse(s.book.date) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const defaultExpiry =
    future.find((d) => d >= fortnight) || future.at(-1) || s.book.date;

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

  /**
   * The NVDA pool, and the curve its rates come off.
   *
   * Depth and borrowed size are simulated — no venue publishes a
   * lending book for this — so the panel says so rather than letting
   * the numbers pass for a market. The curve itself is not simulated:
   * it is the reserve's own two-slope model, which is what actually
   * prices every loan on this screen.
   */
  const reserve = reserveOf('NVDA');
  const pool = feed.marks.NVDA;
  const utilisation = pool?.utilisation ?? 0;
  const here = reserve
    ? rates(utilisation, reserve)
    : { borrow: 0, supply: 0, utilisation: 0 };
  const curve = reserve
    ? Array.from({ length: 101 }, (_, i) => {
        const u = i / 100;
        const r = rates(u, reserve);
        return { u, borrow: r.borrow, supply: r.supply };
      })
    : [];

  /* What each screen is about, as one number, and the three figures
     that explain it. Anything that needed a sentence to read is on the
     review, where the reader has asked for it. */
  const read =
    mode === 'short'
      ? {
          eyebrow: 'Protected short',
          label: 'Most this can cost you',
          value: usd(q * (k - s.market.price) + protection + interest),
          tone: 'down' as const,
          caption: `Capped at ${usd(k)} a share, protection and interest included.`,
          figures: [
            { label: 'You receive now', value: usd(q * s.market.price) },
            { label: 'Protection', value: usd(protection) },
            {
              label: 'Liquidates at',
              value:
                projected?.liquidation != null
                  ? usd(projected.liquidation)
                  : '—',
              detail: projected
                ? `Health ${Number.isFinite(projected.factor) ? projected.factor.toFixed(2) : '∞'}`
                : undefined,
            },
          ],
        }
      : mode === 'lend'
        ? {
            eyebrow: 'Stock loan',
            label: 'You earn, paid at signing',
            value: usd(interest, 4),
            tone: 'up' as const,
            caption: `For lending ${qty(q)} NVDA until ${expiryLabel(end)}.`,
            figures: [
              {
                label: 'Borrower posts',
                value: usd(q * s.market.price * 1.5),
              },
              { label: 'Rate', value: '3.50% APR' },
              { label: 'Term ends', value: expiryLabel(end) },
            ],
          }
        : {
            eyebrow: 'Spot trade',
            label: side === 'buy' ? 'You pay' : 'You receive',
            value: usd(q * s.market.price),
            tone: undefined,
            caption: 'Fully funded from the vault. Settles now.',
            figures: [
              { label: 'Price', value: usd(s.market.price) },
              { label: 'Shares', value: qty(q) },
              { label: 'Direction', value: side === 'buy' ? 'Buy' : 'Sell' },
            ],
          };

  return (
    <div className="od-borrow">
      <div className="od-stack">
        <section className="od-read">
          <span className="od-read-eyebrow">{read.eyebrow}</span>
          <span className="od-read-label">{read.label}</span>
          <b className={read.tone}>{read.value}</b>
          <p>{read.caption}</p>

          <div className="od-figures">
            {read.figures.map((f) => (
              <Stat
                key={f.label}
                label={f.label}
                value={f.value}
                detail={'detail' in f ? f.detail : undefined}
              />
            ))}
          </div>

          {projected && projected.factor < 1.25 && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> That leaves very little room. A move
              against you liquidates the position.
            </p>
          )}
        </section>

        {reserve && (
          <section className="od-pool">
            <div className="od-pool-rates">
              <div className="od-stat">
                <span>Borrow</span>
                <strong className="down">
                  {(here.borrow * 100).toFixed(2)}%
                </strong>
              </div>
              <div className="od-stat">
                <span>Supply</span>
                <strong className="up">
                  {(here.supply * 100).toFixed(2)}%
                </strong>
              </div>
              <p>
                {(utilisation * 100).toFixed(0)}% of the NVDA pool is out.{' '}
                {qty(pool?.supplied ?? 0)} supplied, {qty(pool?.borrowed ?? 0)}{' '}
                borrowed
                {pool?.source === 'simulated' ? ', simulated depth.' : '.'}
              </p>
            </div>
            <RateCurve curve={curve} at={{ ...here, u: utilisation }} />
          </section>
        )}
      </div>

      <Panel className="od-ticket">
        <PanelHead
          title="Your terms"
          action={<Badge tone="accent">NVDA {usd(s.market.price)}</Badge>}
        />
        <div className="od-panel-body">
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
            <Field
              label="Repurchase cap"
              hint={`${((k / s.market.price - 1) * 100).toFixed(1)}% above spot`}
            >
              <input
                aria-label="Protective call strike"
                type="number"
                step="any"
                min={s.market.price + 0.01}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </Field>
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
        </div>
      </Panel>

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
            Pledged protection cannot be reused. The transaction either updates
            every balance and reserve together or rolls back entirely, and the
            backend validates the amounts again.
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
