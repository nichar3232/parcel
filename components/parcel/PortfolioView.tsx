'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { orderGreeks } from '@/lib/parcel/math';
import {
  accruedInterest,
  borrowDebt,
  shortCloseAmounts,
} from '@/lib/parcel/funding';
import {
  RANGES,
  changeOver,
  valueSeries,
  withinRange,
  type Range,
} from '@/lib/parcel/value';
import { QuoteReview } from './QuoteReview';
import type { Quote, VaultAction } from '@/lib/parcel/types';
import { AssetLogo } from './AssetLogo';
import { logoOf } from '@/lib/preipo/registry';
import { Meter, ValueHistory } from './charts';
import { WatchlistView } from './WatchlistView';
import type { Transfer } from './TransferDialog';
import {
  Badge,
  Button,
  Empty,
  Line,
  Modal,
  Money,
  Panel,
  PanelHead,
  Stat,
  dateLabel,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type PortfolioTab =
  | 'overview'
  | 'watchlist'
  | 'positions'
  | 'collateral'
  | 'activity';

/**
 * The portfolio.
 *
 * This was one scrolling page carrying the vault, the allocation, the
 * asset table, three promo cards, the whole activity ledger, the
 * collateral policy, the settlement groups, the requirement breakdown
 * and a reconcile button. Four tabs now, each answering one question:
 * what am I worth, what do I hold, what is pledged, what happened.
 */
export function PortfolioView({
  desk,
  feed,
  tab,
  navigate,
  onTransfer,
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: PortfolioTab;
  navigate: (
    page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending',
    to?: string,
    pick?: string,
  ) => void;
  onTransfer: (t: Transfer) => void;
}) {
  const s = desk.state!;
  const { book, risk, market } = s;
  const underlyings = market.underlyings;

  /* The ledger's session price is the source of the stored balance
     history. The headline is deliberately different: once the mark feed
     is ready it is the cash in the vault plus the shares at their most
     recent observable mark. This keeps a live quote from rewriting a
     past close, while still making the number a desk user sees now react
     to the market. */
  const liveSpots = useMemo(
    () =>
      Object.fromEntries(
        underlyings.map((u) => [
          u.symbol,
          feed.marks[u.symbol]?.price ?? u.price,
        ]),
      ),
    [feed.marks, underlyings],
  );
  const nav = underlyings.reduce(
    (t, u) => t + (book.vault[u.symbol] ?? 0) * u.price,
    book.vault.USDC,
  );
  const liveNav = underlyings.reduce(
    (t, u) => t + (book.vault[u.symbol] ?? 0) * liveSpots[u.symbol],
    book.vault.USDC,
  );
  const hasLiveMark = underlyings.some((u) => !!feed.marks[u.symbol]);
  const displayedNav = hasLiveMark ? liveNav : nav;
  // What is held: every underlying with something in the vault, NVDA
  // always so the list never comes up empty. What sits only in the
  // wallet is deposited from the wallet, not listed here as a zero.
  const held = underlyings.filter(
    (u) => u.symbol === 'NVDA' || (book.vault[u.symbol] ?? 0) > 0,
  );
  const active = book.options.filter((p) => p.status === 'active');

  /**
   * Mark every open contract to the model at the current session price.
   *
   * The desk knew what each position cost and never showed what it was
   * worth, so a book of four contracts had no P&L anywhere in the
   * product.
   */
  const marked = useMemo(
    () =>
      active.map((p) => {
        const on =
          underlyings.find((u) => u.symbol === p.terms.symbol) ??
          underlyings[0];
        const value = orderGreeks(
          p.terms,
          p.terms.reference === 'dividend'
            ? market.dividend
            : (liveSpots[p.terms.symbol] ?? on?.price ?? market.price),
          book.date,
          p.terms.reference === 'dividend'
            ? 0.8
            : (on?.volatility ?? market.volatility),
        ).price;
        // A contract opened this session marks at what it cost. Left
        // alone, floating point turns that into +$0.000000, which reads
        // as a number rather than as "nothing has happened yet".
        const drift = value - p.premium;
        return { position: p, value, pnl: Math.abs(drift) < 5e-7 ? 0 : drift };
      }),
    [active, market, book.date, underlyings, liveSpots],
  );
  const [range, setRange] = useState<Range>('1M');
  const series = useMemo(() => valueSeries(book), [book]);
  const drawn = withinRange(series, range);
  const liveSamples = useLiveValueSamples(feed, displayedNav, s.revision);
  /* The persistent series is session-close accounting. The small tail is
     made only of real marks received during this browser session. It
     never invents an intraday history merely to fill the chart. */
  const chartPoints = useMemo(() => {
    const base = drawn.length ? drawn : [{ date: book.date, value: nav }];
    return [...base, ...liveSamples];
  }, [book.date, drawn, liveSamples, nav]);
  const move = changeOver(chartPoints);
  /* Formatting a zero move as a green +$0.00 is a small lie of tone.
     Keep a cent threshold for the directional treatment, the same
     precision the balance itself is shown at. */
  const directionalMove = move && Math.abs(move.amount) >= 0.005 ? move : null;

  if (tab === 'watchlist') return <WatchlistView />;
  if (tab === 'collateral') return <Collateral desk={desk} />;
  if (tab === 'activity') return <Activity desk={desk} />;

  /**
   * Holdings: what you have, and what is open against it.
   *
   * This screen used to carry a donut of the same three figures printed
   * above it, a price history of one ticker, and a payoff curve summing
   * a book that is usually one contract long — three pictures that were
   * there because the space was. What a reader comes here for is the
   * balance and the list, so the screen is the balance and the list.
   *
   * "Positions" was a second tab showing the same open contracts, and
   * "Collateral" a third showing what the reserved column already says.
   * Positions is folded in below; the collateral policy is a setting,
   * reached from the line that states it.
   */
  return (
    <div className="od-open">
      <div className="od-open-main">
        <div className="od-open-head">
          <span>Vault value</span>
          <strong>
            <Money value={displayedNav} />
          </strong>
          {directionalMove ? (
            <div
              className={`od-open-move ${directionalMove.amount >= 0 ? 'up' : 'down'}`}
            >
              {directionalMove.amount >= 0 ? (
                <TrendingUp size={15} />
              ) : (
                <TrendingDown size={15} />
              )}
              <b>
                <Money value={directionalMove.amount} sign />
              </b>
              <span>({(directionalMove.percent * 100).toFixed(2)}%)</span>
              <em>
                {drawn.length > 1
                  ? RANGES.find((r) => r.id === range)?.label
                  : 'Since open'}
              </em>
            </div>
          ) : (
            <div className="od-open-move flat">
              {hasLiveMark
                ? 'No change from the opening mark. Open contracts are marked separately below.'
                : 'Cash and stock. Open contracts are marked separately below.'}
            </div>
          )}
          <div className={`od-open-feed ${hasLiveMark ? 'live' : ''}`}>
            <i aria-hidden />
            <span>
              {hasLiveMark
                ? 'Live mark'
                : feed.ready
                  ? 'Session mark'
                  : 'Connecting to marks'}
            </span>
            {hasLiveMark && feed.asOf > 0 && (
              <time dateTime={new Date(feed.asOf).toISOString()}>
                Updated{' '}
                {new Intl.DateTimeFormat('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }).format(feed.asOf)}
              </time>
            )}
          </div>
        </div>

        <ValueHistory
          points={chartPoints}
          label={`Vault value across ${drawn.length} completed session${drawn.length === 1 ? '' : 's'}${hasLiveMark ? ' with a live mark' : ''}, ending ${usd(displayedNav)}`}
        />

        <div className="od-range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={range === r.id ? 'active' : ''}
              aria-pressed={range === r.id}
              disabled={series.length < 2}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <section
          className="od-open-positions"
          aria-labelledby="positions-title"
        >
          <div className="od-open-positions-head">
            <div>
              <span>Portfolio</span>
              <h2 id="positions-title">Positions</h2>
              <p>Assets, contracts and financing held in this vault.</p>
            </div>
            <Badge
              tone={
                active.length +
                book.loans.filter((p) => p.status === 'active').length +
                book.shorts.filter((p) => p.status === 'active').length +
                (book.borrows ?? []).filter((p) => p.status === 'active').length
                  ? 'accent'
                  : 'neutral'
              }
            >
              {active.length +
                book.loans.filter((p) => p.status === 'active').length +
                book.shorts.filter((p) => p.status === 'active').length +
                (book.borrows ?? []).filter((p) => p.status === 'active')
                  .length}{' '}
              open
            </Badge>
          </div>

          <div className="od-open-positions-grid">
            {/* The stock is a position, so it belongs with contracts and
                financing rather than in a detached sidebar. Cash remains
                in buying power below: it is spendable capital, not a long
                position. */}
            <Panel>
              <PanelHead
                title={held.length > 1 ? 'Your holdings' : 'Your stock'}
              />
              <div className="od-pos">
                {held.map((u) => {
                  const live = feed.marks[u.symbol];
                  return (
                    <Fragment key={u.symbol}>
                      <div className="od-pos-row od-pos-asset">
                        <AssetLogo
                          symbol={u.symbol}
                          src={logoOf(u.symbol)}
                          size={30}
                        />
                        <div className="od-pos-what">
                          <b>{u.name}</b>
                          <small>
                            {qty(book.vault[u.symbol] ?? 0)} {u.symbol}
                            {(risk.shares[u.symbol] ?? 0) > 0
                              ? `, ${qty(risk.shares[u.symbol])} reserved`
                              : ''}
                            {(book.wallet[u.symbol] ?? 0) > 0
                              ? `, ${qty(book.wallet[u.symbol])} in wallet`
                              : ''}
                          </small>
                        </div>
                        <div className="od-pos-num">
                          <b>
                            {usd(
                              (book.vault[u.symbol] ?? 0) * liveSpots[u.symbol],
                            )}
                          </b>
                          {live && (
                            <small
                              className={live.change >= 0 ? 'od-up' : 'od-down'}
                            >
                              {live.change >= 0 ? '+' : ''}
                              {(live.change * 100).toFixed(2)}%
                            </small>
                          )}
                        </div>
                      </div>
                      <div className="od-pos-row od-pos-actions">
                        <div className="od-row-actions">
                          <button
                            onClick={() =>
                              onTransfer({
                                asset: u.symbol,
                                direction: 'deposit',
                              })
                            }
                            aria-label={`Deposit ${u.symbol}`}
                          >
                            <ArrowDownLeft size={14} />
                            Deposit
                          </button>
                          <button
                            onClick={() =>
                              onTransfer({
                                asset: u.symbol,
                                direction: 'withdraw',
                              })
                            }
                            aria-label={`Withdraw ${u.symbol}`}
                          >
                            <ArrowUpRight size={14} />
                            Withdraw
                          </button>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </Panel>

            <Positions
              marked={marked}
              desk={desk}
              navigate={navigate}
              liveSpots={liveSpots}
            />
          </div>
        </section>

        {/* USDC had a row in the table beside NVDA, which framed the
            cash as a holding you are long rather than as the thing you
            can spend. It is the balance that decides what you can open
            next, so it reads as that and keeps its two actions. */}
        <div className="od-power">
          <div>
            <span>Buying power</span>
            <small>
              {usd(book.vault.USDC)} USDC in vault
              {risk.cash > 0 ? `, ${usd(risk.cash)} reserved` : ''}
            </small>
          </div>
          <b>{usd(risk.freeCash)}</b>
          <div className="od-row-actions">
            <button
              onClick={() =>
                onTransfer({ asset: 'USDC', direction: 'deposit' })
              }
              aria-label="Deposit USDC"
            >
              <ArrowDownLeft size={14} />
              Deposit
            </button>
            <button
              onClick={() =>
                onTransfer({ asset: 'USDC', direction: 'withdraw' })
              }
              aria-label="Withdraw USDC"
            >
              <ArrowUpRight size={14} />
              Withdraw
            </button>
          </div>
        </div>

        <div className="od-holdings-foot">
          <span>
            Collateral mode {book.margin === 'cross' ? 'cross' : 'isolated'}
          </span>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => navigate('Portfolio', 'collateral')}
          >
            Change
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Keep only actual marks received in this browser session. A quote
 * refresh can be flat; that is still a useful observation, and it makes
 * the chart's cadence match the feed rather than an animation timer.
 */
function useLiveValueSamples(feed: MarkFeed, value: number, revision: number) {
  const [samples, setSamples] = useState<{ date: string; value: number }[]>([]);
  const lastAsOf = useRef(0);
  const lastRevision = useRef(revision);

  useEffect(() => {
    /* A deposit, exercise or close changes the number being charted.
       Previous browser-session samples belonged to the prior balance,
       so begin a fresh live tail at the new balance. */
    if (lastRevision.current !== revision) {
      lastRevision.current = revision;
      lastAsOf.current = 0;
      setSamples([]);
    }
    if (!feed.ready || !feed.asOf || !Number.isFinite(value)) return;
    if (feed.asOf === lastAsOf.current) return;
    lastAsOf.current = feed.asOf;
    const point = { date: new Date(feed.asOf).toISOString(), value };
    setSamples((previous) => [...previous.slice(-47), point]);
  }, [feed.asOf, feed.ready, revision, value]);

  return samples;
}

/* ---------------------------------------------------------------- */

function Positions({
  marked,
  desk,
  navigate,
  liveSpots,
}: {
  marked: {
    position: import('@/lib/parcel/types').OptionPosition;
    value: number;
    pnl: number;
  }[];
  desk: VaultController;
  navigate: (
    page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending',
    to?: string,
  ) => void;
  liveSpots: Record<string, number>;
}) {
  const s = desk.state!;
  const loans = s.book.loans.filter((p) => p.status === 'active');
  const shorts = s.book.shorts.filter((p) => p.status === 'active');
  const borrows = (s.book.borrows ?? []).filter((p) => p.status === 'active');
  const openPnl = marked.reduce((t, m) => t + m.pnl, 0);

  /**
   * Closing a loan or a short.
   *
   * These actions used to live on a Lending → Positions tab that listed
   * the same two tables as this one. The tab is gone; the actions came
   * with it, because a position you can see and cannot close is worse
   * than one you cannot see.
   */
  // Closing an option. The button used to sit in a copy of this table
  // on the trade screen, beside the ticket that builds new ones; the
  // table is gone from there, so the action came here with it.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requesting, setRequesting] = useState(false);
  const executeClose = async () => {
    if (quote && (await desk.act({ type: 'execute', quoteId: quote.id })))
      setQuote(null);
  };

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

  /**
   * Every kind of position the vault can hold, listed whether or not
   * it holds any.
   *
   * One blanket "nothing open yet" for the whole rail hid what the
   * desk is even capable of: a reader with no positions could not tell
   * from this screen that contracts, stock loans and protected shorts
   * were three different things they could have. The headings are the
   * shape of the product, so they stay.
   */
  return (
    <>
      <Panel>
        <PanelHead
          title="Open contracts"
          description={
            marked.length
              ? `Marked to model · ${openPnl > 0 ? '+' : ''}${usd(openPnl)} open`
              : undefined
          }
          action={
            <Badge tone={marked.length ? 'accent' : 'neutral'}>
              {marked.length}
            </Badge>
          }
        />
        {!marked.length ? (
          <div className="od-pos-none">
            <p>No contracts open.</p>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('Trade', 'trade')}
            >
              Write one
            </Button>
          </div>
        ) : (
          <div className="od-pos">
            {marked.map(({ position: p, value, pnl }) => {
              const dp = p.terms.reference === 'dividend' ? 4 : 2;
              return (
                <div key={p.id} className="od-pos-row">
                  <div className="od-pos-what">
                    <b>{p.terms.name}</b>
                    <small>
                      {qty(p.terms.quantity)} × {p.terms.symbol} ·{' '}
                      {expiryLabel(p.terms.expiry)}
                    </small>
                  </div>
                  <div className="od-pos-num">
                    <b>{usd(value, dp)}</b>
                    <small className={pnl >= 0 ? 'od-up' : 'od-down'}>
                      {pnl > 0 ? '+' : ''}
                      {usd(pnl, dp)}
                    </small>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={requesting || desk.busy}
                    onClick={() => {
                      setRequesting(true);
                      void desk
                        .closeQuote(p.id)
                        .then(setQuote)
                        .catch((e) => desk.setToast((e as Error).message))
                        .finally(() => setRequesting(false));
                    }}
                  >
                    Close
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="Stock on loan"
          action={<Badge>{loans.length}</Badge>}
        />
        {!loans.length ? (
          <div className="od-pos-none">
            <p>No shares lent out.</p>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('Lending')}
            >
              Lend some
            </Button>
          </div>
        ) : (
          <div className="od-pos">
            {loans.map((p) => (
              <div key={p.id} className="od-pos-row">
                <div className="od-pos-what">
                  <b>
                    {qty(p.quantity)} {p.symbol}
                  </b>
                  <small>Until {expiryLabel(p.expiry)}</small>
                </div>
                <div className="od-pos-num">
                  <b>{usd(p.collateral)}</b>
                  <small>{usd(p.prepaidInterest, 4)} prepaid</small>
                </div>
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
                        ['Shares returned', `${qty(p.quantity)} ${p.symbol}`],
                        [
                          'Unused borrower collateral',
                          'Returned to the borrower after repurchase',
                        ],
                      ],
                    })
                  }
                >
                  Recall
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="Cash borrowed"
          action={<Badge>{borrows.length}</Badge>}
        />
        {!borrows.length ? (
          <div className="od-pos-none">
            <p>Nothing borrowed against your stock.</p>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('Lending')}
            >
              Borrow against stock
            </Button>
          </div>
        ) : (
          <div className="od-pos">
            {borrows.map((p) => {
              const debt = borrowDebt(p, s.book.date);
              return (
                <div key={p.id} className="od-pos-row">
                  <div className="od-pos-what">
                    <b>{usd(p.principal)} USDC</b>
                    <small>
                      Against {qty(p.pledged)} {p.symbol} ·{' '}
                      {(p.apr * 100).toFixed(2)}%{' '}
                      {p.expiry
                        ? `fixed until ${expiryLabel(p.expiry)}`
                        : 'variable'}
                    </small>
                  </div>
                  <div className="od-pos-num">
                    <b>{usd(debt.total)}</b>
                    <small>{usd(debt.interest, 4)} interest owed</small>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={desk.busy}
                    onClick={() =>
                      setReview({
                        action: { type: 'repay', id: p.id },
                        title: 'Review loan repayment',
                        label: 'You pay to repay',
                        value: debt.total,
                        details: [
                          ['Principal', usd(p.principal, 6)],
                          ['Interest accrued', usd(debt.interest, 6)],
                          [
                            'Pledge released',
                            `${qty(p.pledged)} ${p.symbol} back to free collateral`,
                          ],
                        ],
                      })
                    }
                  >
                    Repay
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="Protected shorts"
          action={<Badge>{shorts.length}</Badge>}
        />
        {!shorts.length ? (
          <div className="od-pos-none">
            <p>Nothing sold short.</p>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('Lending')}
            >
              Open a short
            </Button>
          </div>
        ) : (
          <div className="od-pos">
            {shorts.map((p) => {
              const pnl =
                p.quantity *
                  (p.entry - (liveSpots[p.symbol] ?? s.market.price)) -
                p.premium;
              return (
                <div key={p.id} className="od-pos-row">
                  <div className="od-pos-what">
                    <b>
                      {qty(p.quantity)} {p.symbol} short
                    </b>
                    <small>
                      {usd(p.entry)} entry · {usd(p.cap)} cap ·{' '}
                      {expiryLabel(p.expiry)}
                    </small>
                  </div>
                  <div className="od-pos-num">
                    <b className={pnl >= 0 ? 'od-up' : 'od-down'}>
                      {pnl > 0 ? '+' : ''}
                      {usd(pnl)}
                    </b>
                    <small>open</small>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={desk.busy}
                    onClick={() => {
                      const close = shortCloseAmounts(
                        p,
                        liveSpots[p.symbol] ?? s.market.price,
                        s.book.date,
                      );
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
                        ],
                      });
                    }}
                  >
                    Cover
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {quote && (
        <QuoteReview
          quote={quote}
          revision={s.revision}
          busy={desk.busy}
          onClose={() => setQuote(null)}
          onConfirm={() => void executeClose()}
        />
      )}

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

/* ---------------------------------------------------------------- */

function Collateral({ desk }: { desk: VaultController }) {
  const s = desk.state!;
  const r = s.risk;
  return (
    <>
      <div className="od-grid-3">
        <Panel>
          <Stat
            label="Collateral committed"
            value={<Money value={r.collateralValue} />}
            detail={`${usd(r.cash)} plus ${qty(r.shares.NVDA)} NVDA`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Released by offsets"
            value={<Money value={r.releasedValue} />}
            detail="Against standalone position reserves"
            tone={r.releasedValue > 0 ? 'positive' : ''}
          />
        </Panel>
        <Panel>
          <Stat
            label="Free to withdraw"
            value={<Money value={r.availableValue} />}
            detail="Lent and reserved assets excluded"
          />
        </Panel>
      </div>

      <Panel>
        <PanelHead
          title="Collateral policy"
          description="Switching modes recalculates every reserve. An underfunded switch is rejected."
          action={<Badge tone="green">Enforced by the backend</Badge>}
        />
        <div className="od-panel-body od-grid-2">
          {(
            [
              {
                id: 'cross',
                title: 'Cross collateral',
                description:
                  'Net matching settlement obligations. Earlier guaranteed cash receipts can fund later obligations, with every intermediate deficit reserved.',
              },
              {
                id: 'isolated',
                title: 'Isolated collateral',
                description:
                  'Reserve each contract independently. Capital offsets across separate positions do not release collateral.',
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              aria-label={m.title}
              aria-pressed={s.book.margin === m.id}
              className={`od-policy ${s.book.margin === m.id ? 'selected' : ''}`}
              disabled={desk.busy}
              onClick={() => void desk.act({ type: 'margin', mode: m.id })}
            >
              <span className="od-radio" />
              <div>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHead
          title="Requirement"
          description="What each contract would need alone, against what the vault actually reserves."
        />
        <div className="od-panel-body">
          <Meter
            label="Cash requirement"
            value={r.cash}
            of={Math.max(r.grossCash, r.cash, 1)}
            note={`${usd(r.cash)} of ${usd(r.grossCash)} standalone`}
          />
          <Meter
            label="Share requirement"
            value={r.shares.NVDA}
            of={Math.max(r.grossShares.NVDA, r.shares.NVDA, 0.000001)}
            note={`${qty(r.shares.NVDA)} of ${qty(r.grossShares.NVDA)} NVDA standalone`}
            color="var(--pc-magenta)"
          />
          <p className="od-note">
            A share has one job at a time. Withdrawals and sales must leave
            every remaining commitment fully funded.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHead
          title="Settlement groups"
          description="Worst-case delivery is checked at every strike boundary and price tail, before calendar offsets."
        />
        {r.groups.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Expiry group</th>
                  <th className="num">Contracts</th>
                  <th>Settlement</th>
                  <th className="num">Standalone cash</th>
                  <th className="num">Shares reserved</th>
                  <th className="num">Counterparty backing</th>
                </tr>
              </thead>
              <tbody>
                {r.groups.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <b>{dateLabel(g.expiry)}</b>
                    </td>
                    <td className="num">{g.positions}</td>
                    <td>{g.settlement}</td>
                    <td className="num">
                      {usd(g.cash)}
                      {g.cashMinimum > 0 && (
                        <small>Guaranteed {usd(g.cashMinimum, 6)}</small>
                      )}
                    </td>
                    <td className="num">{qty(g.shares)}</td>
                    <td className="num">
                      {usd(g.counterpartyCash)}
                      <small>
                        {qty(g.counterpartyShares)} {g.symbol}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No option obligations yet"
            description="Each funded contract creates a visible reserve here. Protected-short reserves are added separately."
          />
        )}
      </Panel>

      <Panel>
        <div className="od-panel-body od-reconcile">
          <div>
            <b>Vault integrity</b>
            <p className="od-note">
              Re-read every balance and reserve from the ledger and compare it
              with what this screen shows.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void desk.refresh()}>
            Reconcile vault
          </Button>
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- */

function Activity({ desk }: { desk: VaultController }) {
  const s = desk.state!;
  const [query, setQuery] = useState('');
  const events = s.book.events.filter((e) =>
    `${e.title} ${e.detail} ${e.date}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const download = () => {
    const rows = [
      ['date', 'title', 'detail', 'cash', 'shares', 'reference'],
      ...s.book.events.map((e) => [
        e.date,
        e.title,
        e.detail,
        String(e.cash),
        String(e.shares),
        e.reference || '',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parcel-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel>
      <PanelHead
        title="Activity"
        description="Every receipt this vault has issued, newest first."
        action={
          <div className="od-panel-actions">
            <label className="od-search">
              <Search size={15} />
              <input
                aria-label="Search activity"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Button variant="secondary" size="sm" onClick={download}>
              <Download size={14} />
              Export ledger
            </Button>
          </div>
        }
      />
      {events.length ? (
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Session</th>
                <th className="num">Cash</th>
                <th className="num">Shares</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 120).map((e) => (
                <tr key={e.id}>
                  <td>
                    <b>{e.title}</b>
                    <small>{e.detail}</small>
                  </td>
                  <td>{e.date}</td>
                  <td
                    className={`num ${e.cash > 0 ? 'od-up' : e.cash < 0 ? 'od-down' : ''}`}
                  >
                    {e.cash ? usd(e.cash) : '—'}
                  </td>
                  <td className="num">{e.shares ? qty(e.shares) : '—'}</td>
                  <td className="od-muted">{e.id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Nothing matches"
          description="Clear the search to see every receipt this vault has issued."
        />
      )}
      <div className="od-panel-foot">
        <span>Revision {s.revision}</span>
        <span>{s.book.events.length} receipts</span>
      </div>
    </Panel>
  );
}
