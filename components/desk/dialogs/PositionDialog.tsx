'use client';
import { Metric, Status, day } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Desk } from '@/hooks/desk/use-desk';
import { money, reserved } from '@/lib/engine';
import { rowsFor } from '@/lib/scenarios';
import { ArrowRight, CheckCheck, Clock, Shield } from 'lucide-react';
export function PositionDialog({
  current,
  setSelected,
  selectScenario,
  setIndex,
  act,
  now,
  setToast,
  position,
  selected,
  missing,
  setMissing,
  setPage,
  settle,
}: Pick<
  Desk,
  | 'current'
  | 'scenario'
  | 'setSelected'
  | 'terms'
  | 'selectScenario'
  | 'setIndex'
  | 'act'
  | 'now'
  | 'setToast'
  | 'position'
  | 'selected'
  | 'missing'
  | 'setMissing'
  | 'setPage'
  | 'settle'
>) {
  return (
    <Dialog
      open={!!selected}
      onOpenChange={(open) => !open && setSelected(null)}
    >
      <DialogContent className="contract-modal">
        <DialogTitle>
          {position?.status === 'funded'
            ? 'Review your funded offer'
            : 'Your protection contract'}
        </DialogTitle>
        <DialogDescription>
          Local simulation — {position?.id} — terms fixed after maker funding.
        </DialogDescription>
        {position && (
          <>
            <div className="contract-title">
              <div className="round-icon">
                <Shield size={22} />
              </div>
              <div>
                <h2>
                  NVDA{' '}
                  {position.terms.kind === 'put'
                    ? 'downside protection'
                    : 'capped upside'}
                </h2>
                <p>
                  {money(position.terms.low, 0)}–{money(position.terms.high, 0)}{' '}
                  — {position.terms.quantity} shares
                </p>
              </div>
              <Status status={position.status} />
            </div>
            <div className="contract-metrics">
              <Metric
                label="Total debit / maximum loss"
                value={money(position.terms.premium)}
              />
              <Metric
                label="Maximum payout / reserve"
                value={money(position.reserve)}
                positive
              />
            </div>
            <div className="detail-row">
              <span>Buyer / maker</span>
              <strong>Demo holder / demo maker</strong>
            </div>
            <div className="detail-row">
              <span>Fees</span>
              <strong>$0.00</strong>
            </div>
            <div className="detail-row">
              <span>Contracted settlement</span>
              <strong>{day(position.terms.expiry)} — stored daily close</strong>
            </div>
            <div className="detail-row">
              <span>Feed / policy</span>
              <strong>NVDA USD — historical replay v1</strong>
            </div>
            <div className="detail-row">
              <span>Escrow remaining</span>
              <strong>{money(reserved(position))}</strong>
            </div>
            <p className="contract-warning">
              {position.terms.kind === 'put'
                ? `Below ${money(position.terms.low, 0)}, further stock losses resume. `
                : 'The payoff is capped. '}
              Premium is paid in every outcome. Token-basis and issuer risks are
              not covered.
            </p>
            {position.status === 'funded' && (
              <>
                <div className="quote-timer">
                  <Clock size={14} />
                  {Math.max(0, Math.ceil((position.deadline - now) / 1000))}s
                  remaining — no partial fills
                </div>
                <Button
                  className="primary full"
                  disabled={now >= position.deadline}
                  onClick={async () => {
                    if (
                      await act({
                        type: 'accept',
                        id: position.id,
                        now: Date.now(),
                      })
                    )
                      setToast(
                        'Protection is active. Advance the replay to settlement.',
                      );
                  }}
                >
                  Accept & fund — {money(position.terms.premium)}
                </Button>
              </>
            )}
            {['active', 'awaiting'].includes(position.status) && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={missing}
                    onChange={(e) => setMissing(e.target.checked)}
                  />
                  Simulate missing oracle data
                </label>
                <div className="field-note">
                  Replay clock: {day(current.date)}. Settlement uses the exact
                  contracted sample even if replay moves further.
                </div>
                <div className="modal-actions">
                  <Button
                    variant="outline"
                    onClick={() => {
                      selectScenario(position.terms.scenario);
                      setIndex(
                        rowsFor(position.terms.scenario).findIndex(
                          (r) => r.date === position.terms.expiry,
                        ),
                      );
                      setPage('Replay');
                    }}
                  >
                    Advance to expiry <ArrowRight size={13} />
                  </Button>
                  <Button className="primary" onClick={() => settle(position)}>
                    {position.status === 'awaiting'
                      ? 'Retry settlement'
                      : 'Settle position'}
                  </Button>
                </div>
              </>
            )}
            {['settled', 'closed'].includes(position.status) && (
              <>
                <div className="settlement-result">
                  <CheckCheck size={20} />
                  <span>Settled at {money(position.settlementPrice || 0)}</span>
                  <strong>{money(position.buyerPayout)} holder payout</strong>
                </div>
                <div className="modal-actions">
                  <Button
                    className="primary"
                    disabled={position.buyerClaimed}
                    onClick={() =>
                      act({
                        type: 'claim',
                        id: position.id,
                        party: 'holder',
                        now: Date.now(),
                      })
                    }
                  >
                    {position.buyerClaimed
                      ? 'Holder claimed'
                      : `Claim as holder — ${money(position.buyerPayout)}`}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={position.makerClaimed}
                    onClick={() =>
                      act({
                        type: 'claim',
                        id: position.id,
                        party: 'maker',
                        now: Date.now(),
                      })
                    }
                  >
                    {position.makerClaimed
                      ? 'Maker claimed'
                      : `Claim as maker — ${money(position.reserve - position.buyerPayout)}`}
                  </Button>
                </div>
              </>
            )}
            <details className="source-details">
              <summary>Exact terms and recovery</summary>
              <pre>{JSON.stringify(position.terms, null, 2)}</pre>
              <p>
                Practice mode uses two local ledger accounts. Devnet mode uses
                two real team-controlled test wallets and SPL token escrow. No
                quote or settlement here sends a blockchain transaction.
              </p>
            </details>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
