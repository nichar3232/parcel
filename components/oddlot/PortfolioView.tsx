'use client';
import { Fragment, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import { orderGreeks } from '@/lib/oddlot/math';
import {
  accruedInterest,
  borrowDebt,
  shortCloseAmounts,
} from '@/lib/oddlot/funding';
import {
  RANGES,
  changeOver,
  valueSeries,
  withinRange,
  type Range,
} from '@/lib/oddlot/value';
import { QuoteReview } from './QuoteReview';
import type { Quote, VaultAction } from '@/lib/oddlot/types';
import { AssetLogo } from './AssetLogo';
import { MarketStrip } from './MarketStrip';
import { logoOf } from '@/lib/preipo/registry';
import { Meter, ValueHistory } from './charts';
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

export type PortfolioTab = 'overview' | 'positions' | 'collateral' | 'activity';

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
  onPick,
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
  /** Make a symbol the desk's underlying and open the ticket on it. */
  onPick: (symbol: string) => void;
}) {
  const s = desk.state!;
  const { book, risk, market } = s;

  const nav = market.underlyings.reduce(
    (t, u) => t + (book.vault[u.symbol] ?? 0) * u.price,
    book.vault.USDC,
  );
  // What is held: every underlying with something in the vault, NVDA
  // always so the list never comes up empty. What sits only in the
  // wallet is deposited from the wallet, not listed here as a zero.
  const held = market.underlyings.filter(
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
          market.underlyings.find((u) => u.symbol === p.terms.symbol) ??
          market.underlyings[0];
        const value = orderGreeks(
          p.terms,
          p.terms.reference === 'dividend' ? market.dividend : on.price,
          book.date,
          p.terms.reference === 'dividend' ? 0.8 : on.volatility,
        ).price;
        // A contract opened this session marks at what it cost. Left
        // alone, floating point turns that into +$0.000000, which reads
        // as a number rather than as "nothing has happened yet".
        const drift = value - p.premium;
        return { position: p, value, pnl: Math.abs(drift) < 5e-7 ? 0 : drift };
      }),
    [active, market, book.date],
  );
  const [range, setRange] = useState<Range>('1M');
  const series = useMemo(() => valueSeries(book), [book]);
  const drawn = withinRange(series, range);
  const move = changeOver(drawn);

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
            <Money value={nav} />
          </strong>
          {move ? (
            <div className={`od-open-move ${move.amount >= 0 ? 'up' : 'down'}`}>
              {move.amount >= 0 ? (
                <TrendingUp size={15} />
              ) : (
                <TrendingDown size={15} />
              )}
              <b>
                <Money value={move.amount} sign />
              </b>
              <span>({(move.percent * 100).toFixed(2)}%)</span>
              <em>{RANGES.find((r) => r.id === range)?.label}</em>
            </div>
          ) : (
            <div className="od-open-move flat">
              Cash and stock. Open contracts are marked separately below.
            </div>
          )}
        </div>

        {drawn.length > 1 ? (
          <ValueHistory
            points={drawn}
            label={`Vault value across ${drawn.length} sessions, ending ${usd(nav)}`}
          />
        ) : (
          /* One session is a dot, and a dot stretched across 760px is a
             flat line implying a day of no movement. The vault opened
             this session; say so rather than draw it. */
          <div className="od-open-blank">
            <p>
              Your vault opened this session. The value line starts once the
              market clock moves on.
            </p>
          </div>
        )}

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

        <MarketStrip feed={feed} date={book.date} onPick={onPick} />
      </div>

      <aside className="od-open-side">
        {/* The stock is a position, so it is listed with the rest of
            them rather than kept in a table of its own on the other
            side of the screen. Cash is not: it is the buying power
            line under the chart, because it is what you spend. */}
        <Panel>
          <PanelHead title={held.length > 1 ? 'Your holdings' : 'Your stock'} />
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
                      <b>{usd((book.vault[u.symbol] ?? 0) * u.price)}</b>
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
                          onTransfer({ asset: u.symbol, direction: 'deposit' })
                        }
                        aria-label={`Deposit ${u.symbol}`}
                      >
                        <ArrowDownLeft size={14} />
                        Deposit
                      </button>
                      <button
                        onClick={() =>
                          onTransfer({ asset: u.symbol, direction: 'withdraw' })
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

        <Positions marked={marked} desk={desk} navigate={navigate} />
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Positions({
  marked,
  desk,
  navigate,
}: {
  marked: {
    position: import('@/lib/oddlot/types').OptionPosition;
    value: number;
    pnl: number;
  }[];
  desk: VaultController;
  navigate: (
    page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending',
    to?: string,
  ) => void;
}) {
  const s = desk.state!;
  const loans = s.book.loans.filter((p) => p.status === 'active');
  const shorts = s.book.shorts.filter((p) => p.status === 'active');
  const borrows = s.book.borrows.filter((p) => p.status === 'active');
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
              const pnl = p.quantity * (p.entry - s.market.price) - p.premium;
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
                        s.market.price,
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
