'use client';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import {
  exploreGoals,
  explorePreview,
  type ExploreDraft,
} from '@/lib/oddlot/explore';
import { PayoffChart } from '../PayoffChart';
import { Button, dateLabel, qty, usd } from '../shared';

const STEPS = [
  { n: '01', label: 'Intent' },
  { n: '02', label: 'Size' },
  { n: '03', label: 'Review' },
  { n: '04', label: 'Fund' },
];

/**
 * The consumer entry path. Four screens, one decision each, so the
 * position is built up rather than presented all at once.
 */
export function GuidedFlow({
  desk,
  navigate,
  openDraft,
}: {
  desk: VaultController;
  navigate: (page: string) => void;
  openDraft: (page: string, draft: ExploreDraft) => void;
}) {
  const state = desk.state!;
  const [step, setStep] = useState(0);
  const [goalId, setGoalId] = useState('upside');
  const [quantity, setQuantity] = useState(0.25);

  const goal = exploreGoals.find((g) => g.id === goalId)!;
  const preview = explorePreview(goal, quantity, state);
  const nav =
    state.book.vault.USDC + state.book.vault.NVDA * state.market.price;
  const neededShares = Math.max(
    0,
    (preview?.shares || 0) - state.risk.freeShares,
  );

  const go = (next: number) => {
    setStep(next);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

  if (!preview)
    return (
      <div className="gf">
        <section className="gf-panel gf-end">
          <Compass size={30} />
          <h2>This market window is complete.</h2>
          <p>
            Use Market controls to restart once all positions are flat, then
            return to build another position.
          </p>
          <Button variant="secondary" onClick={() => navigate('Vault')}>
            View your vault
          </Button>
        </section>
      </div>
    );

  return (
    <div className="gf">
      <header className="gf-head">
        <div>
          <span className="gf-kicker">Build a position</span>
          <h1>
            {
              [
                'What are you trying to do?',
                'How much of it?',
                'Here is the trade-off.',
                'Fund it.',
              ][step]
            }
          </h1>
        </div>
        <span className="gf-spot">
          NVDA <b>{usd(state.market.price)}</b>
          <small>{dateLabel(state.book.date)}</small>
        </span>
      </header>

      {/* progress rail */}
      <ol className="gf-rail" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li
            key={s.n}
            className={i === step ? 'current' : i < step ? 'done' : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            <button onClick={() => i < step && go(i)} disabled={i > step}>
              <span className="gf-rail-n">{s.n}</span>
              <span className="gf-rail-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {/* ---------- 01 intent ---------- */}
      {step === 0 && (
        <section className="gf-panel" aria-label="Choose an intent">
          <div className="gf-intents">
            {exploreGoals.map((g, i) => (
              <button
                key={g.id}
                className={`gf-intent ${g.id === goalId ? 'selected' : ''}`}
                aria-pressed={g.id === goalId}
                onClick={() => {
                  setGoalId(g.id);
                  go(1);
                }}
              >
                <span className="gf-intent-n">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <strong>{g.title}</strong>
                <p>{g.subtitle}</p>
                <span className="gf-intent-tag">{g.tag}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- 02 size ---------- */}
      {step === 1 && (
        <section className="gf-panel" aria-label="Size the position">
          <div className="gf-size">
            <div className="gf-size-read">
              <label htmlFor="gf-size">Your share-equivalents</label>
              <strong>{qty(quantity)}</strong>
              <span>of a share · {goal.tag.toLowerCase()}</span>
            </div>
            <div className="gf-size-controls">
              <div className="gf-chips">
                {[0.1, 0.25, 0.5, 1].map((q) => (
                  <button
                    key={q}
                    aria-label={`Size ${q} shares`}
                    aria-pressed={quantity === q}
                    className={quantity === q ? 'selected' : ''}
                    onClick={() => setQuantity(q)}
                  >
                    {q === 0.25 ? '¼' : q === 0.5 ? '½' : q}
                  </button>
                ))}
              </div>
              <input
                id="gf-size"
                aria-label="Position size"
                type="range"
                min=".01"
                max="1"
                step=".01"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <small>Fractions are welcome. No 100-share lot.</small>
            </div>
          </div>
          <div className="gf-ledger">
            <div>
              <span>
                {preview.premium >= 0 ? 'Premium paid' : 'Premium received'}
              </span>
              <strong>{usd(Math.abs(preview.premium), 4)}</strong>
            </div>
            <div>
              <span>A standard contract</span>
              <strong>
                {usd(Math.abs(preview.premium) * 100 * (1 / quantity), 2)}
              </strong>
            </div>
            <div>
              <span>Expiry</span>
              <strong>{dateLabel(preview.terms.expiry)}</strong>
            </div>
          </div>
        </section>
      )}

      {/* ---------- 03 review ---------- */}
      {step === 2 && (
        <section className="gf-panel" aria-label="Review the payoff">
          <PayoffChart
            terms={preview.terms}
            premium={preview.premium}
            spot={state.market.price}
            stockQuantity={preview.stockQuantity}
          />
          <p className="gf-tradeoff">{goal.tradeoff}</p>
          <div className="gf-ledger">
            <div>
              <span>
                {preview.premium >= 0 ? 'Premium paid' : 'Premium received'}
              </span>
              <strong>{usd(Math.abs(preview.premium), 4)}</strong>
            </div>
            <div>
              <span>Exercise backing</span>
              <strong>
                {preview.shares
                  ? `${qty(preview.shares)} NVDA`
                  : preview.cash
                    ? usd(preview.cash)
                    : 'None required'}
              </strong>
            </div>
            <div>
              <span>Size</span>
              <strong>{qty(quantity)} share-eq.</strong>
            </div>
          </div>
          <p className="gf-model-note">
            Illustrative model payoff, including estimated premium. Not an
            executed position or a live quote.
          </p>
        </section>
      )}

      {/* ---------- 04 fund ---------- */}
      {step === 3 && (
        <section className="gf-panel" aria-label="Fund and confirm">
          <div className="gf-fund">
            <div className="gf-fund-main">
              <h2>What this will reserve</h2>
              <div className="gf-review-lines">
                <div>
                  <span>Structure</span>
                  <b>{goal.tag}</b>
                </div>
                <div>
                  <span>Size</span>
                  <b>{qty(quantity)} share-equivalents</b>
                </div>
                <div>
                  <span>Expiry</span>
                  <b>{dateLabel(preview.terms.expiry)}</b>
                </div>
                <div>
                  <span>
                    {preview.premium >= 0 ? 'Premium paid' : 'Premium received'}
                  </span>
                  <b>{usd(Math.abs(preview.premium), 4)}</b>
                </div>
                <div>
                  <span>Exercise backing</span>
                  <b>
                    {preview.shares
                      ? `${qty(preview.shares)} NVDA`
                      : preview.cash
                        ? usd(preview.cash)
                        : 'None required'}
                  </b>
                </div>
              </div>
              {!!neededShares && (
                <p className="gf-warn">
                  Standalone backing exceeds your available NVDA by{' '}
                  {qty(neededShares)} shares. A funded quote checks existing
                  collateral offsets.
                </p>
              )}
            </div>
            <aside className="gf-fund-side">
              <span className="gf-kicker">Your vault</span>
              <strong>{usd(nav)}</strong>
              <p>
                {usd(state.risk.availableValue)} available ·{' '}
                {usd(state.risk.collateralValue)} reserved
              </p>
              <button className="gf-link" onClick={() => navigate('Vault')}>
                Assets &amp; funding <ArrowRight size={14} />
              </button>
            </aside>
          </div>
        </section>
      )}

      {/* ---------- footer nav ---------- */}
      <div className="gf-actions">
        <button
          className="gf-back"
          onClick={() => go(step - 1)}
          disabled={step === 0}
        >
          <ArrowLeft size={15} /> Back
        </button>
        {step < 3 ? (
          <Button onClick={() => go(step + 1)}>
            {['Continue', 'Review the payoff', 'Fund this position'][step]}{' '}
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button
            disabled={desk.pending}
            onClick={() =>
              openDraft(goal.page, {
                templateId: goal.template,
                terms: preview.terms,
              })
            }
          >
            Open in the builder <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
