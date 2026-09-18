'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { VaultAction } from '@/lib/oddlot/types';
import { amount } from '@/lib/oddlot/validation';
import { add, mul, round } from '@/lib/oddlot/math';
import {
  borrowDebt,
  borrowInterest,
  termInterest,
  protectionPremium,
} from '@/lib/oddlot/funding';
import {
  borrowLimit,
  health,
  liquidationPrice,
  pledgeLiquidationPrice,
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
  Segmented,
  Stat,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type LendingTab = 'borrow';
type Mode = 'borrow' | 'short' | 'lend' | 'stock';
const MODES: Mode[] = ['borrow', 'short', 'lend', 'stock'];

export function LendingView({
  desk,
  feed,
  mode,
  symbol,
  onSymbol,
}: {
  desk: VaultController;
  feed: MarkFeed;
  /** Borrow, short, lend or spot — chosen in the rail. */
  mode: string;
  /** The underlying being lent, shorted or bought. */
  symbol: string;
  onSymbol: (symbol: string) => void;
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
    const priceOf = (of: string) =>
      s.market.underlyings.find((u) => u.symbol === of)?.price ?? 1;
    const collateral: Holding[] = [
      { symbol: 'USDC', amount: s.book.vault.USDC, price: 1 },
      ...s.market.underlyings.map((u) => ({
        symbol: u.symbol,
        amount: s.book.vault[u.symbol] ?? 0,
        price: u.price,
      })),
    ].filter((h) => h.amount > 0);
    // Every short is debt, each at its own mark; the liquidation level
    // is quoted for the underlying on screen, with the rest as a fixed
    // charge against the same collateral.
    const shortedBy: Record<string, number> = {};
    for (const p of s.book.shorts.filter((p) => p.status === 'active'))
      shortedBy[p.symbol] = (shortedBy[p.symbol] ?? 0) + p.quantity;
    const debt: Holding[] = Object.entries(shortedBy).map(([of, amount]) => ({
      symbol: of,
      amount,
      price: priceOf(of),
    }));
    // Cash loans are dollar debt against the same collateral. Their
    // pledges are already in the vault list above, so the one health
    // factor covers shorts and loans together.
    // A server that predates cash loans answers without the list; a
    // deploy overlap should not blank the whole desk.
    for (const p of (s.book.borrows ?? []).filter((p) => p.status === 'active'))
      debt.push({
        symbol: 'USDC',
        amount: borrowDebt(p, s.book.date).total,
        price: 1,
      });
    const h = health(collateral, debt);
    const weighted = collateral.reduce((t, c) => {
      const r = reserveOf(c.symbol);
      return t + (r ? c.amount * c.price * r.liquidation : 0);
    }, 0);
    const shorted = shortedBy[symbol] ?? 0;
    const otherDebt = debt
      .filter((d) => d.symbol !== symbol)
      .reduce((t, d) => t + d.amount * d.price, 0);
    return {
      ...h,
      collateral,
      debt,
      shorted,
      weighted,
      liquidation: liquidationPrice(weighted, shorted, otherDebt),
    };
  }, [s, symbol]);

  return (
    <Borrow
      desk={desk}
      feed={feed}
      position={position}
      mode={MODES.includes(mode as Mode) ? (mode as Mode) : 'borrow'}
      symbol={symbol}
      onSymbol={onSymbol}
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
    weighted: 0,
    liquidation: null as number | null,
  };
}

/* ---------------------------------------------------------------- */

function Borrow({
  desk,
  feed,
  position,
  mode,
  symbol,
  onSymbol,
}: {
  desk: VaultController;
  feed: MarkFeed;
  position: Position;
  mode: Mode;
  symbol: string;
  onSymbol: (symbol: string) => void;
}) {
  const s = desk.state!;
  const under =
    s.market.underlyings.find((u) => u.symbol === symbol) ??
    s.market.underlyings[0];
  const price = under.price;
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

  const reserve = reserveOf(symbol);
  const [quantity, setQuantity] = useState('1');
  const [cap, setCap] = useState(String(Math.ceil(price * 1.12)));
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  // A cash loan: half of what one share can carry, so the first read
  // shows a loan with room in it rather than one at the edge.
  const [amount_, setAmount] = useState(
    String(
      Math.max(1, Math.floor(reserve ? borrowLimit(1, price, reserve) / 2 : 1)),
    ),
  );
  const [rateKind, setRateKind] = useState<'variable' | 'fixed'>('variable');
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
  const b = Number(amount_);
  const limit = reserve ? borrowLimit(q || 0, price, reserve) : 0;
  const termed = mode !== 'stock' && !(mode === 'borrow' && rateKind === 'variable');

  let valid = !termed || future.length > 0;
  try {
    amount(q);
    if (mode === 'short') {
      amount(k, 0.000001, Math.min(10000, price * 2));
      if (k <= price) valid = false;
    }
    if (mode === 'borrow') {
      amount(b, 0.000001, 1000000);
      if (!reserve || b > limit) valid = false;
    }
  } catch {
    valid = false;
  }

  const interest = valid ? termInterest(q, price, s.book.date, end) : 0;
  const protection =
    valid && mode === 'short'
      ? protectionPremium(q, price, k, s.book.date, end)
      : 0;

  // What this borrow would do to the health factor, before it is taken.
  const projected = (() => {
    if (mode !== 'short' || !valid) return null;
    const weighted = position.weighted;
    const owed = position.owed + q * price;
    const otherDebt = position.debt
      .filter((d) => d.symbol !== symbol)
      .reduce((t, d) => t + d.amount * d.price, 0);
    return {
      factor: owed > 0 ? weighted / owed : Infinity,
      liquidation: liquidationPrice(weighted, position.shorted + q, otherDebt),
      owed,
    };
  })();

  /**
   * The cash loan, as the ledger will price it.
   *
   * The rate is the pool's, off the same curve the panel below draws,
   * read from the live feed; the server reads the same feed when the
   * loan opens, so the two agree to within a poll. A fixed loan's
   * interest is known now; a variable one's is whatever the sessions
   * bring, so it is shown as the first day's run.
   */
  const apr = reserve
    ? rates(feed.marks[symbol]?.utilisation ?? 0, reserve).borrow
    : 0;
  const loan = (() => {
    if (mode !== 'borrow' || !valid || !reserve) return null;
    const termCost =
      rateKind === 'fixed' ? borrowInterest(b, apr, s.book.date, end) : 0;
    const owed = position.owed + b;
    return {
      termCost,
      ltv: q > 0 ? b / (q * price) : 0,
      factor: owed > 0 ? position.weighted / owed : Infinity,
      liquidation: pledgeLiquidationPrice(b + termCost, q, reserve),
    };
  })();
  const aprLabel = `${(apr * 100).toFixed(2)}% APR`;

  const openReview = () =>
    setReview({
      action:
        mode === 'lend'
          ? { type: 'lend', quantity: q, expiry: end, symbol }
          : mode === 'short'
            ? { type: 'short', quantity: q, cap: k, expiry: end, symbol }
            : mode === 'borrow'
              ? {
                  type: 'borrow',
                  pledged: q,
                  amount: b,
                  rate: rateKind,
                  ...(rateKind === 'fixed' ? { expiry: end } : {}),
                  symbol,
                }
              : { type: 'stock', side, quantity: q, symbol },
      revision: s.revision,
      title:
        mode === 'lend'
          ? 'Fund this stock loan?'
          : mode === 'short'
            ? 'Open this protected short?'
            : mode === 'borrow'
              ? 'Draw this cash loan?'
              : 'Confirm stock exchange',
      label:
        mode === 'lend'
          ? 'Borrower posts cash'
          : mode === 'short'
            ? 'Maximum cash reserved'
            : mode === 'borrow'
              ? 'You receive now'
              : 'Total consideration',
      details:
        mode === 'borrow'
          ? [
              ['Pledged', `${qty(q)} ${symbol}, reserved until repaid`],
              [
                'Rate',
                rateKind === 'fixed'
                  ? `${aprLabel}, locked until ${expiryLabel(end)}`
                  : `${aprLabel} today, repriced each session off the ${symbol} pool`,
              ],
              rateKind === 'fixed'
                ? ['Interest over the term', usd(loan?.termCost ?? 0, 6)]
                : ['Interest', 'Accrues each session; repay whenever you like'],
              [
                'Loan-to-value',
                `${((loan?.ltv ?? 0) * 100).toFixed(0)}% drawn of ${Math.round((reserve?.ltv ?? 0) * 100)}% allowed`,
              ],
              [
                'Pledge sold if',
                loan?.liquidation != null
                  ? `${symbol} closes below ${usd(loan.liquidation)}`
                  : '—',
              ],
              [
                'At term end',
                rateKind === 'fixed'
                  ? 'Repaid from vault cash, or from the pledge if the cash is not there'
                  : 'No term. Repay from the portfolio when you choose',
              ],
            ]
          : mode === 'stock'
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
              ['Stock sale proceeds', usd(mul(q, price), 6)],
              [
                'Protective call',
                `Buy ${qty(q)} ${symbol} call at ${usd(mode === 'lend' ? round(price * 1.5) : k, 2)}`,
              ],
              [
                `Protection premium paid by ${mode === 'lend' ? 'the borrower' : 'you'}`,
                usd(
                  mode === 'lend'
                    ? protectionPremium(
                        q,
                        price,
                        round(price * 1.5),
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
                  : usd(add(mul(q, price), -protection), 6),
              ],
            ],
      value:
        mode === 'lend'
          ? add(mul(q, round(price * 1.5)), interest)
          : mode === 'short'
            ? add(mul(q, k), interest)
            : mode === 'borrow'
              ? b
              : mul(q, price),
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
  const pool = feed.marks[symbol];
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
    mode === 'borrow'
      ? {
          eyebrow: 'Borrow against stock',
          label: 'You receive now',
          value: usd(b || 0),
          tone: 'up' as const,
          caption:
            rateKind === 'fixed'
              ? `Locked at ${aprLabel} until ${expiryLabel(end)}. ${qty(q)} ${symbol} stays in your vault, pledged.`
              : `${aprLabel} today, repriced each session as the ${symbol} pool moves. ${qty(q)} ${symbol} stays in your vault, pledged.`,
          figures: [
            {
              label: rateKind === 'fixed' ? 'Interest over term' : 'Rate',
              value:
                rateKind === 'fixed'
                  ? usd(loan?.termCost ?? 0, 4)
                  : `${(apr * 100).toFixed(2)}%`,
              detail:
                rateKind === 'fixed'
                  ? aprLabel
                  : `${usd(borrowInterest(b || 0, apr, s.book.date, new Date(Date.parse(s.book.date) + 86_400_000).toISOString().slice(0, 10)), 4)} a day`,
            },
            {
              label: 'Loan-to-value',
              value: `${((loan?.ltv ?? 0) * 100).toFixed(0)}%`,
              detail: reserve
                ? `Up to ${usd(limit)} at ${Math.round(reserve.ltv * 100)}%`
                : undefined,
            },
            {
              label: 'Pledge sold at',
              value:
                loan?.liquidation != null ? usd(loan.liquidation) : '—',
              detail: loan
                ? `Health ${Number.isFinite(loan.factor) ? loan.factor.toFixed(2) : '∞'}`
                : undefined,
            },
          ],
        }
      : mode === 'short'
      ? {
          eyebrow: 'Protected short',
          label: 'Most this can cost you',
          value: usd(q * (k - price) + protection + interest),
          tone: 'down' as const,
          caption: `Capped at ${usd(k)} a share, protection and interest included.`,
          figures: [
            { label: 'You receive now', value: usd(q * price) },
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
            caption: `For lending ${qty(q)} ${symbol} until ${expiryLabel(end)}.`,
            figures: [
              {
                label: 'Borrower posts',
                value: usd(q * price * 1.5),
              },
              { label: 'Rate', value: '3.50% APR' },
              { label: 'Term ends', value: expiryLabel(end) },
            ],
          }
        : {
            eyebrow: 'Spot trade',
            label: side === 'buy' ? 'You pay' : 'You receive',
            value: usd(q * price),
            tone: undefined,
            caption: 'Fully funded from the vault. Settles now.',
            figures: [
              { label: 'Price', value: usd(price) },
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
          {mode === 'borrow' && reserve && b > limit && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> {symbol} lends up to{' '}
              {Math.round(reserve.ltv * 100)}% of its value. Pledge more shares
              or draw at most {usd(limit)}.
            </p>
          )}
          {loan && loan.factor < 1.25 && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> That leaves very little room. A move
              against you sells the pledge.
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
                {(utilisation * 100).toFixed(0)}% of the {symbol} pool is out.{' '}
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
          action={
            <Badge tone={under.simulated ? 'neutral' : 'accent'}>
              {symbol} {usd(price)}
            </Badge>
          }
        />
        <div className="od-panel-body">
          <Field label="Underlying">
            <select
              aria-label="Underlying"
              value={symbol}
              onChange={(e) => onSymbol(e.target.value)}
            >
              {s.market.underlyings.map((u) => (
                <option key={u.symbol} value={u.symbol}>
                  {u.name} ({u.symbol}) · {usd(u.price)}
                  {u.simulated ? ' · simulated path' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={mode === 'borrow' ? 'Shares pledged' : 'Shares'}
            hint={`Available ${qty(s.risk.freeShares[symbol] ?? 0)} ${symbol}`}
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

          {mode === 'borrow' && (
            <>
              <Field
                label="Borrow"
                hint={reserve ? `Up to ${usd(limit)} USDC` : undefined}
              >
                <input
                  aria-label="Borrow amount"
                  type="number"
                  min="0.000001"
                  max={limit || undefined}
                  step="any"
                  value={amount_}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Rate">
                <Segmented
                  label="Rate"
                  value={rateKind}
                  onChange={setRateKind}
                  options={[
                    {
                      id: 'variable',
                      label: 'Variable',
                      hint: 'Repriced each session off the pool',
                    },
                    {
                      id: 'fixed',
                      label: 'Fixed',
                      hint: 'Locked for the term',
                    },
                  ]}
                />
              </Field>
            </>
          )}

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
          ) : !termed ? null : (
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
              hint={`${((k / price - 1) * 100).toFixed(1)}% above spot`}
            >
              <input
                aria-label="Protective call strike"
                type="number"
                step="any"
                min={price + 0.01}
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
                : mode === 'borrow'
                  ? 'cash loan'
                  : 'stock trade'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </Panel>

      {review && (
        <Modal
          title={review.title}
          description={`${qty(q)} ${symbol} at the ${usd(price)} stored reference`}
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
