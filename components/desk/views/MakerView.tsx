'use client';
import { Metric, Status, day } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { money, signed } from '@/lib/engine';
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Lock,
} from 'lucide-react';
export function MakerView({
  book,
  totalLocked,
  navigate,
  quotePremium,
  setQuotePremium,
  act,
  now,
  setToast,
  setSelected,
}: Pick<
  Desk,
  | 'book'
  | 'totalLocked'
  | 'filter'
  | 'navigate'
  | 'terms'
  | 'quotePremium'
  | 'setQuotePremium'
  | 'act'
  | 'now'
  | 'setToast'
  | 'setSelected'
>) {
  return (
    <>
      <div className="role-banner">
        <BriefcaseBusiness size={17} />
        <p>
          You’re the demo maker. Your reserve secures the holder’s payout.
          Switch back to review as the holder after funding.
        </p>
        <span className="pill">SECOND PRACTICE WALLET</span>
      </div>
      <section className="metrics-grid maker-metrics">
        <Metric
          label="Available quote capital"
          value={money(book.makerCash)}
          note="Demo USDC · unencumbered"
        />
        <Metric
          label="Committed collateral"
          value={money(totalLocked)}
          note="Reserved once per contract"
        />
        <Metric
          label="Incoming requests"
          value={String(
            book.positions.filter((p) => p.status === 'requested').length,
          )}
          note="Manual pricing · full fills only"
        />
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Requests & funded offers</h2>
          <span className="subtle">One disclosed demo maker</span>
        </div>
        {book.positions.length === 0 ? (
          <div className="empty">
            <BriefcaseBusiness size={28} />
            <h3>No requests yet.</h3>
            <p>Start with a holder’s downside-protection request.</p>
            <Button className="primary" onClick={() => navigate('Build')}>
              Build a request <ArrowRight size={14} />
            </Button>
          </div>
        ) : (
          book.positions.map((p) => (
            <div className="maker-request" key={p.id}>
              <div className="flex-between">
                <div>
                  <strong>
                    NVDA {p.terms.kind === 'put' ? 'put spread' : 'call spread'}
                  </strong>
                  <p>
                    {money(p.terms.low, 0)} / {money(p.terms.high, 0)} ·{' '}
                    {p.terms.quantity} shares · {day(p.terms.expiry)}
                  </p>
                </div>
                <Status status={p.status} />
              </div>
              <div className="maker-request-details">
                <span>
                  Maximum payout<strong>{money(p.reserve)}</strong>
                </span>
                <span>
                  Worst-case maker PnL
                  <strong>
                    {signed(
                      Number(quotePremium[p.id] ?? p.terms.premium) - p.reserve,
                    )}
                  </strong>
                </span>
                <span>
                  Request<strong className="mono">{p.id}</strong>
                </span>
              </div>
              {p.status === 'requested' ? (
                <div className="maker-action">
                  <label htmlFor={`maker-${p.id}`}>
                    Your total premium
                    <input
                      id={`maker-${p.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={quotePremium[p.id] ?? p.terms.premium}
                      onChange={(e) =>
                        setQuotePremium({
                          ...quotePremium,
                          [p.id]: e.target.value,
                        })
                      }
                    />
                  </label>
                  <Button
                    className="primary"
                    onClick={async () => {
                      if (
                        await act({
                          type: 'fund',
                          id: p.id,
                          premium: Number(
                            quotePremium[p.id] ?? p.terms.premium,
                          ),
                          now: Date.now(),
                        })
                      )
                        setToast(
                          'Full collateral reserved. Review and accept as the holder.',
                        );
                    }}
                  >
                    <Lock size={14} />
                    Fund offer · {money(p.reserve)}
                  </Button>
                </div>
              ) : p.status === 'funded' ? (
                <div className="maker-action">
                  <span className="subtle">
                    {Math.max(0, Math.ceil((p.deadline - now) / 1000))}s left on
                    quote
                  </span>
                  <Button
                    variant="outline"
                    onClick={() =>
                      act({ type: 'cancel', id: p.id, now: Date.now() })
                    }
                  >
                    Cancel & reclaim
                  </Button>
                  <Button className="primary" onClick={() => setSelected(p.id)}>
                    Review as holder <ArrowRight size={14} />
                  </Button>
                </div>
              ) : (
                <div className="maker-action">
                  <Button variant="outline" onClick={() => setSelected(p.id)}>
                    View contract <ArrowUpRight size={13} />
                  </Button>
                  {p.status === 'settled' && !p.makerClaimed && (
                    <Button
                      className="primary"
                      onClick={() =>
                        act({
                          type: 'claim',
                          id: p.id,
                          party: 'maker',
                          now: Date.now(),
                        })
                      }
                    >
                      Claim {money(p.reserve - p.buyerPayout)}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}
