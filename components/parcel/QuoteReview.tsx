'use client';
import { useEffect, useState } from 'react';
import type { Quote } from '@/lib/parcel/types';
import { Button, Line, Modal, Money, expiryLabel, qty, usd } from './shared';

/**
 * The last screen before a contract exists.
 *
 * It answers three questions in order: what it costs, what it is, and
 * what the vault looks like afterwards. The previous version answered
 * them as ten identical label/value rows with the premium the same size
 * as the settlement style, so the one figure that decides whether to
 * sign had to be hunted for.
 *
 * The countdown is driven by the server's issue time. A browser clock
 * that is behind cannot be used to extend a quote past its life.
 */
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
    const deadline = quote.reviewDeadline ?? performance.now();
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline - performance.now()) / 1000)),
      );
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [quote.id, quote.reviewDeadline]);

  const stale = quote.revision !== revision;
  const dead = !remaining;

  return (
    <Modal
      title={closing ? 'Review your close quote' : 'Review your funded quote'}
      description={`${quote.terms.name}, ${qty(quote.terms.quantity)} share-equivalents, expiring ${expiryLabel(quote.terms.expiry)}`}
      onClose={onClose}
    >
      <div className="od-quote-premium">
        <span>{quote.premium >= 0 ? 'You pay' : 'You receive'}</span>
        <strong>
          <Money value={Math.abs(quote.premium)} decimals={4} />
        </strong>
        <small>
          {quote.terms.settlement === 'physical'
            ? 'Plus the exercise cash and delivery shares below'
            : 'Cash settled, with capped obligations'}
        </small>
      </div>

      {quote.terms.curve ? (
        <div className="od-quote-curve">
          <b>
            {closing
              ? quote.terms.curve.side === 'buy'
                ? 'Sell to close'
                : 'Buy to close'
              : quote.terms.curve.side === 'buy'
                ? 'Buy'
                : 'Sell'}{' '}
            {quote.terms.curve.shape}, {quote.terms.curve.direction}
          </b>
          <p>
            Range {usd(quote.terms.curve.lower, 6)} to{' '}
            {usd(quote.terms.curve.upper, 6)}. Maximum payout{' '}
            {usd(quote.terms.curve.cap, 6)} per share-equivalent, or{' '}
            {usd(quote.terms.curve.cap * quote.terms.quantity, 6)} for this
            contract, settled in cash at the committed event.
          </p>
        </div>
      ) : (
        <div className="od-table-wrap">
          <table className="od-table od-quote-legs">
            <thead>
              <tr>
                <th>{closing ? 'Leg to close' : 'Side'}</th>
                <th>Type</th>
                <th className="num">Strike</th>
                <th className="num">Ratio</th>
                <th className="num">Shares</th>
              </tr>
            </thead>
            <tbody>
              {quote.terms.legs.map((l, i) => {
                const side = closing
                  ? l.side === 'buy'
                    ? 'sell'
                    : 'buy'
                  : l.side;
                return (
                  <tr key={i}>
                    <td>
                      <span className={`od-leg-side ${side}`}>
                        {side === 'buy' ? '+' : '−'}
                      </span>
                      {side === 'buy' ? 'Buy' : 'Sell'}
                    </td>
                    <td>{l.kind}</td>
                    <td className="num">
                      {usd(l.strike, l.strike < 1 ? 4 : 2)}
                    </td>
                    <td className="num">{l.ratio}×</td>
                    <td className="num">
                      {qty(l.ratio * quote.terms.quantity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="od-lines">
        <Line
          label="Settlement"
          value={`${quote.terms.reference}, ${quote.terms.settlement}`}
          tone="muted"
        />
        <Line label="Expiry" value={expiryLabel(quote.terms.expiry)} />
        <Line
          label="Cash reserved after this trade"
          value={usd(quote.cashRequired)}
        />
        <Line
          label="Shares reserved after this trade"
          value={`${qty(quote.sharesRequired)} ${quote.terms.symbol}`}
        />
        <Line label="Cash left available" value={usd(quote.cashAfter)} />
        <Line
          label="Shares left available"
          value={`${qty(quote.sharesAfter)} ${quote.terms.symbol}`}
        />
        {quote.releasedValue > 0 && (
          <Line
            label="Released by collateral offsets"
            value={usd(quote.releasedValue)}
            tone="up"
          />
        )}
      </div>

      {stale && (
        <p className="od-error" role="alert">
          Your vault changed. Close this review and request a fresh quote.
        </p>
      )}
      {!quote.eligible && (
        <p className="od-error" role="alert">
          {quote.reason}
        </p>
      )}

      <div className={`od-quote-clock ${dead ? 'dead' : ''}`}>
        <i style={{ width: `${Math.min(100, (remaining / 30) * 100)}%` }} />
        <span>
          {dead
            ? 'Quote expired. Close this review and request a fresh one.'
            : `Quote expires in ${remaining}s`}
        </span>
      </div>

      <Button
        size="lg"
        full
        disabled={busy || dead || !quote.eligible || stale}
        onClick={onConfirm}
      >
        {busy ? 'Executing…' : closing ? 'Confirm close' : 'Confirm contract'}
      </Button>
    </Modal>
  );
}
