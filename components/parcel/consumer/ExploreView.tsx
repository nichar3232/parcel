'use client';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  Layers3,
  Shield,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import {
  exploreGoals,
  explorePreview,
  type ExploreDraft,
} from '@/lib/parcel/explore';
import { PayoffChart } from '../PayoffChart';
import { Button, dateLabel, qty, usd } from '../shared';
export function ExploreView({
  desk,
  navigate,
  openDraft,
}: {
  desk: VaultController;
  navigate: (page: string) => void;
  openDraft: (page: string, draft: ExploreDraft) => void;
}) {
  const state = desk.state!;
  const [goalId, setGoalId] = useState('upside'),
    [quantity, setQuantity] = useState(0.25);
  const goal = exploreGoals.find((g) => g.id === goalId)!;
  const preview = explorePreview(goal, quantity, state);
  const icons = [ArrowUpRight, Shield, Layers3];
  const nav =
    state.book.vault.USDC + state.book.vault.NVDA * state.market.price;
  const neededShares = Math.max(
    0,
    (preview?.shares || 0) - state.risk.freeShares.NVDA,
  );
  return (
    <div className="oc-home">
      <div className="oc-heading">
        <div>
          <span className="oc-kicker">
            <Sparkles size={14} /> EXPLORE A POSITION AT YOUR SIZE
          </span>
          <h1>
            Make your next move <em>make sense.</em>
          </h1>
          <p>Start with an idea. Change the size. See both sides.</p>
        </div>
      </div>
      <div className="oc-layout">
        <div className="oc-playground">
          <div className="oc-section-title">
            <span className="oc-step">01</span>
            <h2>What would you like to explore?</h2>
          </div>
          <div className="oc-goals">
            {exploreGoals.map((g, i) => {
              const Icon = icons[i];
              return (
                <button
                  key={g.id}
                  className={`oc-goal ${g.tone} ${g.id === goalId ? 'selected' : ''}`}
                  aria-pressed={g.id === goalId}
                  onClick={() => setGoalId(g.id)}
                >
                  <span className="oc-goal-top">
                    <span className="oc-goal-icon">
                      <Icon size={20} />
                    </span>
                    {g.id === goalId && <Check size={15} />}
                  </span>
                  <strong>{g.title}</strong>
                  <span>{g.subtitle}</span>
                </button>
              );
            })}
          </div>
          {preview ? (
            <section
              className={`oc-scenario ${goal.tone}`}
              aria-label="Position explorer"
            >
              <div className="oc-scenario-heading">
                <div>
                  <span className="oc-kicker">{goal.tag}</span>
                  <h2>Small enough to make it yours.</h2>
                </div>
                <span className="oc-market-pill">
                  <i /> NVDA {usd(state.market.price)}
                </span>
              </div>
              <div className="oc-size-row">
                <div>
                  <label htmlFor="explore-size">Your share-equivalents</label>
                  <div className="oc-size-value">
                    <strong>{qty(quantity)}</strong>
                    <span>of a share</span>
                  </div>
                </div>
                <div className="oc-size-controls">
                  <div className="oc-size-chips">
                    {[0.1, 0.25, 0.5, 1].map((q) => (
                      <button
                        key={q}
                        aria-label={`Explore ${q} shares`}
                        aria-pressed={quantity === q}
                        className={quantity === q ? 'selected' : ''}
                        onClick={() => setQuantity(q)}
                      >
                        {q === 0.25 ? '¼' : q === 0.5 ? '½' : q}
                      </button>
                    ))}
                  </div>
                  <input
                    id="explore-size"
                    aria-label="Explore position size"
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
              <div className="oc-scenario-divider">
                <span className="oc-step">02</span>
                <h3>Move the price. Watch the trade-off.</h3>
                <span>Expiry {dateLabel(preview.terms.expiry)}</span>
              </div>
              <PayoffChart
                terms={preview.terms}
                premium={preview.premium}
                spot={state.market.price}
                stockQuantity={preview.stockQuantity}
              />
              <div className="oc-tradeoff">
                <Shield size={17} />
                <p>{goal.tradeoff}</p>
              </div>
              <div className="oc-funding">
                <div>
                  <span>
                    {preview.premium >= 0
                      ? 'Estimated premium paid'
                      : 'Estimated premium received'}
                  </span>
                  <strong>{usd(Math.abs(preview.premium), 4)}</strong>
                </div>
                <div>
                  <span>Standalone exercise backing</span>
                  <strong>
                    {preview.shares
                      ? `${qty(preview.shares)} NVDA`
                      : preview.cash
                        ? usd(preview.cash)
                        : 'No buyer exercise backing'}
                  </strong>
                </div>
              </div>
              {!!neededShares && (
                <p className="oc-funding-note">
                  Standalone backing exceeds your available NVDA by{' '}
                  {qty(neededShares)} shares. A funded quote checks any existing
                  collateral offsets.
                </p>
              )}
              <div className="oc-continue">
                <div>
                  <span className="oc-kicker">03 · WHEN THE NUMBERS CLICK</span>
                  <p>Carry this exact size and strategy into review.</p>
                </div>
                <Button
                  disabled={desk.pending}
                  onClick={() =>
                    openDraft(goal.page, {
                      templateId: goal.template,
                      terms: preview.terms,
                    })
                  }
                >
                  Open this setup <ArrowRight size={16} />
                </Button>
              </div>
              <p className="oc-model-note">
                Illustrative model payoff, including estimated premium. This is
                not an executed position or a live quote. The builder requests
                actual vault funding before confirmation.
              </p>
            </section>
          ) : (
            <section className="oc-scenario oc-window-end">
              <Compass size={32} />
              <h2>This market window is complete.</h2>
              <p>
                Use Market controls to restart once all positions are flat, then
                return to explore another setup.
              </p>
              <Button variant="secondary" onClick={() => navigate('Vault')}>
                View your vault
              </Button>
            </section>
          )}
        </div>
        <div className="oc-right">
          <section className="oc-vault-summary">
            <div>
              <Wallet size={18} />
              <h2>Your vault, at a glance</h2>
            </div>
            <strong>{usd(nav)}</strong>
            <p>
              {usd(state.risk.availableValue)} available ·{' '}
              {usd(state.risk.collateralValue)} reserved
            </p>
            <button onClick={() => navigate('Vault')}>
              View assets & funding <ArrowRight size={15} />
            </button>
            <small>
              Actual saved balances
              {state.mode === 'localnet'
                ? ' · local-validator test assets (not mainnet)'
                : state.mode === 'devnet'
                  ? ' · devnet test assets (not mainnet)'
                  : ''}
            </small>
          </section>
        </div>
      </div>
    </div>
  );
}
