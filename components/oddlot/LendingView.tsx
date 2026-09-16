'use client';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { VaultAction } from '@/lib/oddlot/types';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import { amount } from '@/lib/oddlot/validation';
import { add, mul, round } from '@/lib/oddlot/math';
import {
  accruedInterest,
  termInterest,
  protectionPremium,
  shortCloseAmounts,
} from '@/lib/oddlot/funding';
import {
  Badge,
  Button,
  Empty,
  Field,
  Heading,
  Modal,
  Panel,
  Stat,
  dateLabel,
  qty,
  usd,
} from './shared';
export function LendingView({ desk }: { desk: VaultController }) {
  const s = desk.state!,
    future = s.market.dates.filter((d) => d > s.book.date),
    defaultExpiry =
      future.find((d) => d >= '2025-02-07') || future[0] || s.book.date;
  const [mode, setMode] = useState<'lend' | 'short' | 'stock'>('lend'),
    [quantity, setQuantity] = useState('1'),
    [cap, setCap] = useState('160'),
    [expiry, setExpiry] = useState(defaultExpiry),
    [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [review, setReview] = useState<{
      action: VaultAction;
      revision: number;
      quantity: number;
      price: number;
      title: string;
      label: string;
      value: number;
      details: [string, string][];
    } | null>(null);
  const end = expiry > s.book.date ? expiry : defaultExpiry,
    q = Number(quantity),
    k = Number(cap);
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
  const openReview = () =>
    setReview({
      action:
        mode === 'lend'
          ? { type: 'lend', quantity: q, expiry: end }
          : mode === 'short'
            ? { type: 'short', quantity: q, cap: k, expiry: end }
            : { type: 'stock', side, quantity: q },
      revision: s.revision,
      quantity: q,
      price: s.market.price,
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
              ['Settlement', 'Immediate stock / USDC exchange'],
            ]
          : [
              ['Term ends', end],
              ['Borrow rate', '3.50% APR'],
              ['Full-term interest', usd(interest, 6)],
              ['Stock sale proceeds', usd(mul(q, s.market.price), 6)],
              [
                'Protective call',
                `Buy ${qty(q)} NVDA call · strike ${usd(mode === 'lend' ? round(s.market.price * 1.5) : k, 6)} · ratio 1×`,
              ],
              [
                'Protection premium paid by ' +
                  (mode === 'lend' ? 'borrower' : 'you'),
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
  const loans = s.book.loans.filter((p) => p.status === 'active'),
    shorts = s.book.shorts.filter((p) => p.status === 'active');
  return (
    <>
      <Heading
        eyebrow="CAPITAL WITH A CLEAR JOB"
        title="Lend shares. Trade both directions."
        description="Funded stock lending, cash-paid longs, and shorts with a contractual cap on repayment."
      />
      <div className="od-three-grid od-metrics">
        <Panel>
          <Stat
            label="Available to lend"
            value={`${qty(s.risk.freeShares)} NVDA`}
            detail="Unpledged vault shares"
          />
        </Panel>
        <Panel>
          <Stat
            label="Stock out on loan"
            value={`${qty(loans.reduce((v, p) => v + p.quantity, 0))} NVDA`}
            detail="Principal remains an owned receivable"
          />
        </Panel>
        <Panel>
          <Stat
            label="Protected short exposure"
            value={`${qty(shorts.reduce((v, p) => v + p.quantity, 0))} NVDA`}
            detail="Covered by reserved protective calls"
          />
        </Panel>
      </div>
      <div className="od-builder-grid">
        <Panel className="od-order-form">
          <div className="od-panel-heading">
            <h2>Put your capital to work</h2>
            <Badge>NVDA</Badge>
          </div>
          <div className="od-segmented">
            {(['lend', 'short', 'stock'] as const).map((m) => (
              <button
                key={m}
                className={mode === m ? 'selected' : ''}
                onClick={() => setMode(m)}
              >
                {m === 'lend'
                  ? 'Lend stock'
                  : m === 'short'
                    ? 'Protected short'
                    : 'Buy / sell stock'}
              </button>
            ))}
          </div>
          <div className="od-form-content">
            <Field label="Share quantity">
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
                  <option value="buy">Buy · fully cash funded</option>
                  <option value="sell">Sell · owned shares only</option>
                </select>
              </Field>
            ) : (
              <Field label="Term ends">
                <select value={end} onChange={(e) => setExpiry(e.target.value)}>
                  {future.map((d) => (
                    <option key={d} value={d}>
                      {dateLabel(d)}, 2025
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {mode === 'short' && (
              <Field
                label="Protective call strike"
                help="Caps the stock repurchase price. Full strike cash stays reserved."
              >
                <input
                  type="number"
                  step="any"
                  min={s.market.price + 0.01}
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              </Field>
            )}
            <div className="od-order-summary">
              {mode === 'lend' ? (
                <>
                  <div>
                    <span>Borrower collateral</span>
                    <b>{usd(q * s.market.price * 1.5)}</b>
                  </div>
                  <div>
                    <span>Test fixed borrow rate</span>
                    <b>3.50% APR</b>
                  </div>
                  <div>
                    <span>Full-term interest prepaid</span>
                    <b>{usd(interest, 4)}</b>
                  </div>
                </>
              ) : mode === 'short' ? (
                <>
                  <div>
                    <span>Stock sale proceeds</span>
                    <b>{usd(q * s.market.price)}</b>
                  </div>
                  <div>
                    <span>Protective call estimate</span>
                    <b>{usd(protection)}</b>
                  </div>
                  <div>
                    <span>Maximum cash reserved</span>
                    <b>{usd(q * k + interest)}</b>
                  </div>
                  <div>
                    <span>Maximum loss incl. protection</span>
                    <b>
                      {usd(q * (k - s.market.price) + protection + interest)}
                    </b>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>Reference price</span>
                    <b>{usd(s.market.price)}</b>
                  </div>
                  <div>
                    <span>Total consideration</span>
                    <b>{usd(q * s.market.price)}</b>
                  </div>
                </>
              )}
            </div>
            <Button disabled={!valid || desk.busy} onClick={openReview}>
              Review{' '}
              {mode === 'lend'
                ? 'stock loan'
                : mode === 'short'
                  ? 'protected short'
                  : 'stock trade'}
              <ArrowRight size={16} />
            </Button>
            <p className="od-form-note">
              Test assets and counterparties. Pledged protection cannot be
              reused.
            </p>
          </div>
        </Panel>

        <div className="od-builder-insight">
          <Panel>
            <div className="od-panel-heading">
              <h2>Stock loans</h2>
              <Badge tone="neutral">{loans.length} active</Badge>
            </div>
            {loans.length ? (
              <div className="od-table-wrap">
                <table className="od-table">
                  <thead>
                    <tr>
                      <th>Principal / borrower use</th>
                      <th>Term ends</th>
                      <th>Borrower cash collateral</th>
                      <th>Interest prepaid</th>
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
                              Sold at {usd(p.productive.entry)} · protected at{' '}
                              {usd(p.productive.cap)}
                            </small>
                          )}
                        </td>
                        <td>{dateLabel(p.expiry)}</td>
                        <td>{usd(p.collateral)}</td>
                        <td>{usd(p.prepaidInterest, 4)}</td>
                        <td>
                          <Button
                            variant="quiet"
                            disabled={desk.busy}
                            onClick={() =>
                              setReview({
                                action: { type: 'recall', id: p.id },
                                revision: s.revision,
                                quantity: p.quantity,
                                price: s.market.price,
                                title: 'Review stock recall',
                                label: 'Interest you receive',
                                value: accruedInterest(
                                  p.prepaidInterest,
                                  p.opened,
                                  p.expiry,
                                  s.book.date,
                                ),
                                details: [
                                  [
                                    'Shares returned',
                                    `${qty(p.quantity)} NVDA`,
                                  ],
                                  [
                                    'Unused borrower collateral',
                                    'Returned to borrower after repurchase',
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
                title="No shares out on loan."
                description="Lend available stock to receive a collateral-backed claim and prepaid test interest."
              />
            )}
          </Panel>
          <Panel>
            <div className="od-panel-heading">
              <h2>Protected shorts</h2>
              <Badge tone="neutral">{shorts.length} active</Badge>
            </div>
            {shorts.length ? (
              <div className="od-table-wrap">
                <table className="od-table">
                  <thead>
                    <tr>
                      <th>Quantity</th>
                      <th>Entry</th>
                      <th>Protection strike</th>
                      <th>Term ends</th>
                      <th>Maximum cash reserved</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shorts.map((p) => (
                      <tr key={p.id}>
                        <td>{qty(p.quantity)} NVDA</td>
                        <td>{usd(p.entry)}</td>
                        <td>{usd(p.cap)}</td>
                        <td>{dateLabel(p.expiry)}</td>
                        <td>{usd(p.quantity * p.cap + p.maxInterest)}</td>
                        <td>
                          <Button
                            variant="quiet"
                            disabled={desk.busy}
                            onClick={() =>
                              setReview({
                                action: { type: 'close-short', id: p.id },
                                revision: s.revision,
                                quantity: p.quantity,
                                price: s.market.price,
                                title: 'Review short close',
                                label: 'You pay to cover and repay',
                                value: shortCloseAmounts(
                                  p,
                                  s.market.price,
                                  s.book.date,
                                ).total,
                                details: [
                                  [
                                    'Repurchase cost',
                                    usd(
                                      shortCloseAmounts(
                                        p,
                                        s.market.price,
                                        s.book.date,
                                      ).repurchase,
                                      6,
                                    ),
                                  ],
                                  [
                                    'Accrued borrow cost',
                                    usd(
                                      shortCloseAmounts(
                                        p,
                                        s.market.price,
                                        s.book.date,
                                      ).interest,
                                      6,
                                    ),
                                  ],
                                  [
                                    'Total position P&L including paid protection',
                                    usd(
                                      shortCloseAmounts(
                                        p,
                                        s.market.price,
                                        s.book.date,
                                      ).pnl,
                                      6,
                                    ),
                                  ],
                                  [
                                    'Protective call retired',
                                    `Strike ${usd(p.cap, 6)} · expiry ${p.expiry}`,
                                  ],
                                ],
                              })
                            }
                          >
                            Cover & repay
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No open stock shorts."
                description="A protective call makes the maximum repayment explicit before the borrow begins."
              />
            )}
          </Panel>
        </div>
      </div>
      {review && (
        <Modal
          title={review.title}
          description={`${qty(review.quantity)} NVDA · ${usd(review.price)} stored reference`}
          onClose={() => setReview(null)}
        >
          <div className="od-review-line">
            <span>{review.label}</span>
            <b>{usd(review.value, 6)}</b>
          </div>
          {review.details.map(([label, value]) => (
            <div className="od-review-line" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
          {review.revision !== s.revision && (
            <p className="od-error" role="alert">
              Your vault changed. Close this review and review the current
              terms.
            </p>
          )}
          <p className="od-form-note">
            The transaction either updates every balance and reserve together or
            rolls back entirely. Amounts are validated again by the backend.
          </p>
          <Button
            disabled={desk.busy || review.revision !== s.revision}
            onClick={() => void confirm()}
          >
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </>
  );
}
