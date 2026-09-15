'use client';
import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import { days, optionGreeks } from '@/lib/oddlot/math';
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
    [review, setReview] = useState(false);
  const end = expiry > s.book.date ? expiry : defaultExpiry,
    q = Number(quantity),
    k = Number(cap);
  const valid =
    Number.isFinite(q) &&
    q > 0 &&
    q <= 1000 &&
    (mode !== 'short' || (Number.isFinite(k) && k > s.market.price)) &&
    (mode === 'stock' || future.length > 0);
  const interest = (q * s.market.price * 0.035 * days(s.book.date, end)) / 365;
  const protection =
    Number.isFinite(k) && k > 0
      ? optionGreeks('call', s.market.price, k, days(s.book.date, end)).price *
        q
      : 0;
  const confirm = async () => {
    const ok = await desk.act(
      mode === 'lend'
        ? { type: 'lend', quantity: q, expiry: end }
        : mode === 'short'
          ? { type: 'short', quantity: q, cap: k, expiry: end }
          : { type: 'stock', side, quantity: q },
    );
    if (ok) setReview(false);
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
            <Button
              disabled={!valid || desk.busy}
              onClick={() => setReview(true)}
            >
              Review{' '}
              {mode === 'lend'
                ? 'stock loan'
                : mode === 'short'
                  ? 'protected short'
                  : 'stock trade'}
              <ArrowRight size={16} />
            </Button>
            <p className="od-form-note">
              All assets, counterparties, and rates in this environment are for
              testing. Borrowed or pledged shares cannot be pledged again.
            </p>
          </div>
        </Panel>
        <Panel className="od-explainer od-lending-explainer">
          <div className="od-shield">
            <ShieldCheck size={30} />
          </div>
          <span className="od-eyebrow">COLLATERAL BEFORE CONFIDENCE</span>
          <h2>
            {mode === 'short'
              ? 'A finite reserve needs a finite obligation.'
              : mode === 'lend'
                ? 'Know what backs your stock loan.'
                : 'Ownership starts with full funding.'}
          </h2>
          <p>
            {mode === 'short'
              ? 'An ordinary short can lose without limit. Oddlot’s protected short pairs each borrowed share with a covered call and reserves the strike cash plus full-term borrow cost. Sale proceeds remain in the vault.'
              : mode === 'lend'
                ? 'The test borrower transfers 150% of the opening stock value as cash collateral, plus the entire term’s interest. Borrowed shares are earmarked for repayment and never reused as option collateral.'
                : 'Spot purchases exchange your available USDC for shares at the stored reference price. Selling is limited to owned, unencumbered shares; it cannot silently create a naked short.'}
          </p>
          <ol>
            {(mode === 'short'
              ? [
                  'Borrow and sell the exact share quantity.',
                  'Buy a share-backed protective call.',
                  'Lock the maximum repayment and borrow cost.',
                  'Repurchase or exercise, then return the shares.',
                ]
              : mode === 'lend'
                ? [
                    'Check that your shares are available.',
                    'Verify the borrower’s funded collateral.',
                    'Transfer shares and record your receivable.',
                    'Recall anytime; receive accrued test interest.',
                  ]
                : [
                    'Deposit cash into your vault.',
                    'Review the exact reference and consideration.',
                    'Exchange assets atomically.',
                    'Use available shares for covered underwriting.',
                  ]
            ).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </Panel>
      </div>
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
                  <th>Principal</th>
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
                    </td>
                    <td>{dateLabel(p.expiry)}</td>
                    <td>{usd(p.collateral)}</td>
                    <td>{usd(p.prepaidInterest, 4)}</td>
                    <td>
                      <Button
                        variant="quiet"
                        disabled={desk.busy}
                        onClick={() =>
                          void desk.act({ type: 'recall', id: p.id })
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
                          void desk.act({ type: 'close-short', id: p.id })
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
      {review && (
        <Modal
          title={
            mode === 'lend'
              ? 'Fund this stock loan?'
              : mode === 'short'
                ? 'Open this protected short?'
                : 'Confirm stock exchange'
          }
          description={`${qty(q)} NVDA · ${usd(s.market.price)} stored reference`}
          onClose={() => setReview(false)}
        >
          <div className="od-review-line">
            <span>
              {mode === 'lend'
                ? 'Borrower posts cash'
                : mode === 'short'
                  ? 'Maximum cash reserved'
                  : 'Total consideration'}
            </span>
            <b>
              {usd(
                mode === 'lend'
                  ? q * s.market.price * 1.5
                  : mode === 'short'
                    ? q * k + interest
                    : q * s.market.price,
              )}
            </b>
          </div>
          <p className="od-form-note">
            The transaction either updates every balance and reserve together or
            rolls back entirely. Amounts are validated again by the backend.
          </p>
          <Button disabled={desk.busy} onClick={() => void confirm()}>
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </>
  );
}
