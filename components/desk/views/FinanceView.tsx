'use client';
import { Metric } from '@/components/desk/shared';
import type { Desk } from '@/hooks/desk/use-desk';
import { money } from '@/lib/engine';
import {
  ArrowRight,
  ExternalLink,
  Info,
  Landmark,
  Lock,
  Shield,
  Wallet,
} from 'lucide-react';
export function FinanceView({
  financeTab,
  setFinanceTab,
  borrowQty,
  setBorrowQty,
  borrowAmount,
  setBorrowAmount,
  current,
  book,
  totalLocked,
}: Pick<
  Desk,
  | 'financeTab'
  | 'setFinanceTab'
  | 'borrowQty'
  | 'setBorrowQty'
  | 'borrowAmount'
  | 'setBorrowAmount'
  | 'current'
  | 'book'
  | 'totalLocked'
>) {
  return (
    <>
      <div className="segmented finance-tabs">
        <button
          className={financeTab === 'borrow' ? 'selected' : ''}
          onClick={() => setFinanceTab('borrow')}
        >
          Borrow cash
        </button>
        <button
          className={financeTab === 'lend' ? 'selected' : ''}
          onClick={() => setFinanceTab('lend')}
        >
          Lend stock tokens
        </button>
        <button
          className={financeTab === 'allocation' ? 'selected' : ''}
          onClick={() => setFinanceTab('allocation')}
        >
          Capital map
        </button>
      </div>
      {financeTab === 'borrow' ? (
        <div className="finance-grid">
          <section className="panel">
            <div className="section-heading">
              <div className="asset-cell">
                <span className="venue-icon">K</span>
                <div>
                  <h2>Kamino integration</h2>
                  <p>External lending venue</p>
                </div>
              </div>
              <span className="pill">Read-only discovery</span>
            </div>
            <p className="finance-intro">
              Borrowing belongs alongside protection. A live compatible reserve
              and executable path must be verified before any collateral is
              deposited.
            </p>
            <div className="detail-row">
              <span>NVDA token reserve</span>
              <strong>Not verified in this build</strong>
            </div>
            <div className="detail-row">
              <span>Current borrow rate / liquidity</span>
              <strong>Unavailable</strong>
            </div>
            <div className="detail-row">
              <span>Connected debt</span>
              <strong>None</strong>
            </div>
            <div className="detail-row">
              <span>Derivative margin offset</span>
              <strong>None — gross reservations</strong>
            </div>
            <a
              className="external-button"
              href="https://kamino.com/docs/build/developers/borrow"
              target="_blank"
              rel="noreferrer"
            >
              Open venue documentation <ExternalLink size={14} />
            </a>
            <div className="info-strip">
              <Info size={15} />
              <p>
                No borrowing transaction is offered. The calculator uses
                explicit hypothetical parameters, not live lending terms.
              </p>
            </div>
          </section>
          <section className="panel">
            <span className="eyebrow">EXPLORE THE MECHANICS</span>
            <h2>What borrowing would change</h2>
            <label htmlFor="borrow-qty">
              Hypothetical pledged shares <strong>{borrowQty} / 100</strong>
            </label>
            <input
              id="borrow-qty"
              type="range"
              min="1"
              max="100"
              value={borrowQty}
              onChange={(e) => setBorrowQty(+e.target.value)}
            />
            <label htmlFor="borrow-amount">
              Hypothetical debt (USDC)
              <input
                id="borrow-amount"
                type="number"
                min="0"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(Math.max(0, +e.target.value))}
              />
            </label>
            <div className="detail-row">
              <span>Available shares after pledge</span>
              <strong>{100 - borrowQty}</strong>
            </div>
            <div className="detail-row">
              <span>Loan to reference value</span>
              <strong>
                {((borrowAmount / (borrowQty * current.close)) * 100).toFixed(
                  1,
                )}
                %
              </strong>
            </div>
            <div className="detail-row">
              <span>At a hypothetical 70% threshold</span>
              <strong>{money(borrowAmount / (borrowQty * 0.7))} / share</strong>
            </div>
            <p className="field-note">
              Threshold is illustrative. Real venue rules, interest, price feeds
              and liquidation costs differ. A hedge in separate escrow does not
              increase external borrowing capacity.
            </p>
          </section>
        </div>
      ) : financeTab === 'lend' ? (
        <section className="panel lending-preview">
          <span className="eyebrow">PRODUCT PREVIEW</span>
          <h2>Make the return obligation explicit.</h2>
          <p>
            Lending a stock token is a different product from borrowing cash
            against it. It needs real borrow demand, collateral, and a binding
            token-return policy.
          </p>
          <div className="three-metrics">
            <Metric label="Borrow demand" value="Unverified" />
            <Metric label="Current lend rate" value="Unavailable" />
            <Metric label="Withdrawals" value="Inventory dependent" />
          </div>
          <div className="info-strip">
            <Lock size={17} />
            <p>
              Execution is not enabled. Borrowed-out tokens cannot be promised
              back instantly. Corporate actions, recalls and bad-debt allocation
              need binding terms first.
            </p>
          </div>
          <a
            className="external-button"
            href="https://docs.xstocks.fi/docs"
            target="_blank"
            rel="noreferrer"
          >
            Explore issuer mechanics <ExternalLink size={14} />
          </a>
        </section>
      ) : (
        <section className="panel">
          <div className="section-heading">
            <h2>One portfolio. Explicit ownership.</h2>
            <span className="pill">No double counting</span>
          </div>
          <div className="capital-map">
            <div>
              <Wallet />
              <strong>Holder wallet</strong>
              <span>{money(book.holderCash)} USDC</span>
              <small>Available to spend</small>
            </div>
            <ArrowRight />
            <div>
              <Shield />
              <strong>Derivative escrow</strong>
              <span>{money(totalLocked)} USDC</span>
              <small>Funded by the maker</small>
            </div>
            <ArrowRight />
            <div>
              <Landmark />
              <strong>External venues</strong>
              <span>No connected positions</span>
              <small>Separate custody and rules</small>
            </div>
          </div>
          <p className="finance-intro">
            The 100 test share-equivalents remain with the holder. Put-spread
            protection uses separately reserved maker USDC. No stock is pledged
            or transferred to create the hedge.
          </p>
        </section>
      )}
    </>
  );
}
