'use client';
import { useEffect, useState } from 'react';
import type { Quote } from '@/lib/oddlot/types';
import { Button, Modal, qty, usd, dateLabel } from './shared';
export function QuoteReview({
  quote,
  revision,
  busy,
  onClose,
  onConfirm,
}: {
  quote: Quote;
  revision: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const closing = quote.intent === 'close';
  const [remaining, setRemaining] = useState(30);
  useEffect(() => {
    // Use the server timestamp so a skewed browser clock cannot extend the review.
    const deadline = quote.reviewDeadline ?? performance.now();
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline - performance.now()) / 1000)),
      );
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [quote.id, quote.reviewDeadline]);
  return (
    <Modal
      title={closing ? 'Review your close quote' : 'Review your funded quote'}
      description={`${quote.terms.name} · ${qty(quote.terms.quantity)} shares · ${dateLabel(quote.terms.expiry)}`}
      onClose={onClose}
    >
      <div className="od-quote-premium">
        <span>{quote.premium >= 0 ? 'You pay' : 'You receive'}</span>
        <strong>{usd(Math.abs(quote.premium), 6)}</strong>
      </div>
      {quote.terms.curve && (
        <div className="od-curve-review">
          <b>
            {closing
              ? quote.terms.curve.side === 'buy'
                ? 'sell to close'
                : 'buy to close'
              : quote.terms.curve.side}{' '}
            · {quote.terms.curve.shape} · {quote.terms.curve.direction}
          </b>
          <p>
            Range {usd(quote.terms.curve.lower, 6)} to{' '}
            {usd(quote.terms.curve.upper, 6)}. Maximum payout{' '}
            {usd(quote.terms.curve.cap, 6)} per share-equivalent;{' '}
            {usd(quote.terms.curve.cap * quote.terms.quantity, 6)} for this
            contract. Cash settlement at the committed event.
          </p>
        </div>
      )}
      {!quote.terms.curve && (
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>{closing ? 'Leg to close' : 'Side'}</th>
                <th>Type</th>
                <th>Strike</th>
                <th>Ratio</th>
                <th>Shares</th>
              </tr>
            </thead>
            <tbody>
              {quote.terms.legs.map((l, i) => (
                <tr key={i}>
                  <td>
                    {closing
                      ? l.side === 'buy'
                        ? 'Sell'
                        : 'Buy'
                      : l.side === 'buy'
                        ? 'Buy'
                        : 'Sell'}
                  </td>
                  <td>{l.kind}</td>
                  <td>{usd(l.strike, 6)}</td>
                  <td>{l.ratio}×</td>
                  <td>{qty(l.ratio * quote.terms.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="od-review-line">
        <span>Reference / settlement</span>
        <b>
          {quote.terms.reference} · {quote.terms.settlement}
        </b>
      </div>
      <div className="od-review-line">
        <span>Expiration</span>
        <b>{quote.terms.expiry}</b>
      </div>
      <div className="od-review-line">
        <span>Vault cash reserved after trade</span>
        <b>{usd(quote.cashRequired, 6)}</b>
      </div>
      <div className="od-review-line">
        <span>Vault shares reserved after trade</span>
        <b>{qty(quote.sharesRequired)} NVDA</b>
      </div>
      <div className="od-review-line">
        <span>Available cash after trade</span>
        <b>{usd(quote.cashAfter, 6)}</b>
      </div>
      <div className="od-review-line">
        <span>Available shares after trade</span>
        <b>{qty(quote.sharesAfter)} NVDA</b>
      </div>
      {quote.revision !== revision && (
        <p className="od-error" role="alert">
          Your vault changed. Close this review and request a fresh quote.
        </p>
      )}
      {!quote.eligible && (
        <p className="od-error" role="alert">
          {quote.reason}
        </p>
      )}
      <p className="od-form-note">
        {remaining > 0
          ? `Quote expires in ${remaining}s. `
          : 'Quote expired. Close this review and request a fresh quote. '}{' '}
        Physical contracts prefund exercise cash and delivery shares.
      </p>
      <Button
        disabled={
          busy || !remaining || !quote.eligible || quote.revision !== revision
        }
        onClick={onConfirm}
      >
        {busy ? 'Executing…' : closing ? 'Confirm close' : 'Confirm contract'}
      </Button>
    </Modal>
  );
}
