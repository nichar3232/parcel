'use client';
import { useMemo, useState } from 'react';
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
import { accruedInterest, shortCloseAmounts } from '@/lib/oddlot/funding';
import type { Asset, VaultAction } from '@/lib/oddlot/types';
import { AssetLogo, ASSETS } from './AssetLogo';
import { Meter } from './charts';
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
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: PortfolioTab;
  navigate: (page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending', to?: string) => void;
  onTransfer: (t: Transfer) => void;
}) {
  const s = desk.state!;
  const { book, risk, market } = s;
  const live = feed.marks.NVDA;

  const nav = book.vault.USDC + book.vault.NVDA * market.price;
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
        const value = orderGreeks(
          p.terms,
          p.terms.reference === 'dividend' ? market.dividend : market.price,
          book.date,
          p.terms.reference === 'dividend' ? 0.8 : market.volatility,
        ).price;
        // A contract opened this session marks at what it cost. Left
        // alone, floating point turns that into +$0.000000, which reads
        // as a number rather than as "nothing has happened yet".
        const drift = value - p.premium;
        return { position: p, value, pnl: Math.abs(drift) < 5e-7 ? 0 : drift };
      }),
    [active, market, book.date],
  );
  const openPnl = marked.reduce((t, m) => t + m.pnl, 0);

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
    <>
      <div className="od-summary">
        <div className="od-summary-main">
          <span>Vault value</span>
          <strong>
            <Money value={nav} />
          </strong>
          <div className="od-summary-sub">
            <span>{qty(book.vault.NVDA)} NVDA</span>
            <span>{usd(book.vault.USDC)} USDC</span>
            {live && (
              <span className={live.change >= 0 ? 'up' : 'down'}>
                {live.change >= 0 ? (
                  <TrendingUp size={13} />
                ) : (
                  <TrendingDown size={13} />
                )}
                NVDA {(live.change * 100).toFixed(2)}% today
              </span>
            )}
          </div>
        </div>
        <div className="od-summary-stats one">
          <Stat
            label="Open contract P&L"
            value={<Money value={openPnl} sign />}
            detail={`${active.length} marked to model`}
            tone={openPnl > 0 ? 'positive' : openPnl < 0 ? 'negative' : ''}
          />
        </div>
      </div>

      <Panel>
        <PanelHead title="Your assets" />
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">In vault</th>
                <th className="num">Reserved</th>
                <th className="num">Available</th>
                <th className="num">Wallet</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(['NVDA', 'USDC'] as const).map((asset) => (
                <tr key={asset}>
                  <td>
                    <div className="od-asset-cell">
                      <AssetLogo symbol={asset} size={34} />
                      <div>
                        <b>{ASSETS[asset].name}</b>
                        <small>
                          {asset}
                          {feed.marks[asset]
                            ? `  ${usd(feed.marks[asset].price, asset === 'USDC' ? 4 : 2)}`
                            : ''}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="num">{qty(book.vault[asset])}</td>
                  <td className="num">
                    {qty(asset === 'NVDA' ? risk.shares : risk.cash)}
                  </td>
                  <td className="num">
                    <b>{qty(asset === 'NVDA' ? risk.freeShares : risk.freeCash)}</b>
                  </td>
                  <td className="num od-muted">{qty(book.wallet[asset])}</td>
                  <td>
                    <div className="od-row-actions">
                      <button
                        onClick={() =>
                          onTransfer({ asset: asset as Asset, direction: 'deposit' })
                        }
                        aria-label={`Deposit ${asset}`}
                      >
                        <ArrowDownLeft size={14} />
                        Deposit
                      </button>
                      <button
                        onClick={() =>
                          onTransfer({ asset: asset as Asset, direction: 'withdraw' })
                        }
                        aria-label={`Withdraw ${asset}`}
                      >
                        <ArrowUpRight size={14} />
                        Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="od-holdings-foot">
        <span>Collateral mode {book.margin === 'cross' ? 'cross' : 'isolated'}</span>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => navigate('Portfolio', 'collateral')}
        >
          Change
        </Button>
      </div>

      <Positions marked={marked} desk={desk} navigate={navigate} />
    </>
  );
}

/* ---------------------------------------------------------------- */

function Positions({
  marked,
  desk,
  navigate,
}: {
  marked: { position: import('@/lib/oddlot/types').OptionPosition; value: number; pnl: number }[];
  desk: VaultController;
  navigate: (page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending', to?: string) => void;
}) {
  const s = desk.state!;
  const loans = s.book.loans.filter((p) => p.status === 'active');
  const shorts = s.book.shorts.filter((p) => p.status === 'active');
  const settled = s.book.options.filter((p) => p.status !== 'active');

  /**
   * Closing a loan or a short.
   *
   * These actions used to live on a Lending → Positions tab that listed
   * the same two tables as this one. The tab is gone; the actions came
   * with it, because a position you can see and cannot close is worse
   * than one you cannot see.
   */
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

  if (!marked.length && !loans.length && !shorts.length && !settled.length)
    return (
      <Panel>
        <Empty
          title="Nothing open yet"
          description="Write your first contract and it will be listed here with its live mark, its collateral and its worst case."
          action={
            <Button onClick={() => navigate('Trade', 'trade')}>
              Open the trade ticket
            </Button>
          }
        />
      </Panel>
    );

  return (
    <>
      {!!marked.length && (
        <Panel>
          <PanelHead
            title="Open contracts"
            description="Marked to the same model the desk quotes with, at the current session price."
            action={<Badge tone="accent">{marked.length} active</Badge>}
          />
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th className="num">Quantity</th>
                  <th>Expiry</th>
                  <th className="num">Paid</th>
                  <th className="num">Mark</th>
                  <th className="num">P&amp;L</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {marked.map(({ position: p, value, pnl }) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.terms.name}</b>
                      <small>{p.id.slice(0, 8).toUpperCase()}</small>
                    </td>
                    <td className="num">{qty(p.terms.quantity)}</td>
                    <td>{expiryLabel(p.terms.expiry)}</td>
                    <td className="num">
                      {usd(
                        Math.abs(p.premium),
                        p.terms.reference === 'dividend' ? 4 : 2,
                      )}
                    </td>
                    <td className="num">
                      {usd(value, p.terms.reference === 'dividend' ? 4 : 2)}
                    </td>
                    <td className={`num ${pnl >= 0 ? 'od-up' : 'od-down'}`}>
                      {pnl > 0 ? '+' : ''}
                      {usd(pnl, p.terms.reference === 'dividend' ? 4 : 2)}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={desk.busy}
                        onClick={() => navigate('Trade', 'trade')}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!!loans.length && (
        <Panel>
          <PanelHead title="Stock on loan" action={<Badge>{loans.length}</Badge>} />
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
                    </td>
                    <td>{expiryLabel(p.expiry)}</td>
                    <td className="num">{usd(p.collateral)}</td>
                    <td className="num">{usd(p.prepaidInterest, 4)}</td>
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
        </Panel>
      )}

      {!!shorts.length && (
        <Panel>
          <PanelHead
            title="Protected shorts"
            action={<Badge>{shorts.length}</Badge>}
          />
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th className="num">Quantity</th>
                  <th className="num">Entry</th>
                  <th className="num">Protection</th>
                  <th>Term ends</th>
                  <th className="num">Open P&amp;L</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shorts.map((p) => {
                  const pnl =
                    p.quantity * (p.entry - s.market.price) - p.premium;
                  return (
                    <tr key={p.id}>
                      <td className="num">{qty(p.quantity)}</td>
                      <td className="num">{usd(p.entry)}</td>
                      <td className="num">{usd(p.cap)}</td>
                      <td>{expiryLabel(p.expiry)}</td>
                      <td className={`num ${pnl >= 0 ? 'od-up' : 'od-down'}`}>
                        {pnl > 0 ? '+' : ''}
                        {usd(pnl)}
                      </td>
                      <td>
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
                          Cover &amp; repay
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!!settled.length && (
        <Panel>
          <PanelHead
            title="Closed and settled"
            description="Realised outcomes, kept for the record."
          />
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Opened</th>
                  <th className="num">Premium</th>
                  <th className="num">Cash settled</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {settled.slice(0, 20).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.terms.name}</b>
                    </td>
                    <td>{expiryLabel(p.opened)}</td>
                    <td className="num">{usd(Math.abs(p.premium))}</td>
                    <td className="num">{usd(p.cashFlow ?? 0)}</td>
                    <td>
                      <Badge tone={p.status === 'settled' ? 'green' : 'neutral'}>
                        {p.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
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
            detail={`${usd(r.cash)} plus ${qty(r.shares)} NVDA`}
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
            value={r.shares}
            of={Math.max(r.grossShares, r.shares, 0.000001)}
            note={`${qty(r.shares)} of ${qty(r.grossShares)} NVDA standalone`}
            color="var(--pc-magenta)"
          />
          <p className="od-note">
            A share has one job at a time. Withdrawals and sales must leave every
            remaining commitment fully funded.
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
                      <small>{qty(g.counterpartyShares)} NVDA</small>
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
    `${e.title} ${e.detail} ${e.date}`.toLowerCase().includes(query.toLowerCase()),
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
                  <td className={`num ${e.cash > 0 ? 'od-up' : e.cash < 0 ? 'od-down' : ''}`}>
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
