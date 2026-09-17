'use client';
import { Metric, PayoffChart, day } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { breakEven, maximum, money } from '@/lib/engine';
import { scenarios } from '@/lib/scenarios';
import {
  ArrowRight,
  ArrowUpRight,
  Info,
  Link as LinkIcon,
  Lock,
  Shield,
  TrendingUp,
} from 'lucide-react';
export function BuildView({
  terms,
  setTerms,
  scenarioId,
  selectScenario,
  rows,
  scenario,
  entry,
  valid,
  request,
  setModal,
  combined,
  setCombined,
}: Pick<
  Desk,
  | 'terms'
  | 'setTerms'
  | 'scenarioId'
  | 'selectScenario'
  | 'rows'
  | 'filter'
  | 'scenario'
  | 'entry'
  | 'valid'
  | 'request'
  | 'setModal'
  | 'combined'
  | 'setCombined'
>) {
  return (
    <>
      <div className="builder-grid">
        <section className="panel builder-form">
          <div className="section-heading">
            <h2>The structure</h2>
            <span className="count">01</span>
          </div>
          <div className="field-label">
            Underlying
            <div className="asset-field">
              <div className="asset-icon small">N</div>
              <strong>NVIDIA</strong>
              <span>NVDA / USD</span>
            </div>
          </div>
          <div className="field-label">What’s your view?</div>
          <div className="segmented">
            <button
              className={terms.kind === 'put' ? 'selected' : ''}
              onClick={() => setTerms({ ...terms, kind: 'put' })}
            >
              <Shield size={14} />
              Protect downside
            </button>
            <button
              className={terms.kind === 'call' ? 'selected' : ''}
              onClick={() => setTerms({ ...terms, kind: 'call' })}
            >
              <TrendingUp size={14} />
              Capped upside
            </button>
          </div>
          <label htmlFor="build-scenario">Historical scenario</label>
          <select
            id="build-scenario"
            value={scenarioId}
            onChange={(e) => selectScenario(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="field-grid">
            <label htmlFor="low">
              Lower strike
              <input
                id="low"
                type="number"
                min="0.01"
                step="0.01"
                value={terms.low}
                onChange={(e) => setTerms({ ...terms, low: +e.target.value })}
              />
            </label>
            <label htmlFor="high">
              Upper strike
              <input
                id="high"
                type="number"
                min="0.01"
                step="0.01"
                value={terms.high}
                onChange={(e) => setTerms({ ...terms, high: +e.target.value })}
              />
            </label>
          </div>
          <div className="range-visual">
            <span>{money(terms.low, 0)}</span>
            <div />
            <span>{money(terms.high, 0)}</span>
          </div>
          <label htmlFor="quantity">
            Share-equivalent quantity
            <input
              id="quantity"
              type="number"
              min="0.000001"
              max="1000"
              step="1"
              value={terms.quantity}
              onChange={(e) =>
                setTerms({ ...terms, quantity: +e.target.value })
              }
            />
          </label>
          <div className="field-note">
            You hold 100 practice shares. Above 100, part of this is a
            standalone derivative.
          </div>
          <label htmlFor="expiry">
            Settlement session
            <select
              id="expiry"
              value={terms.expiry}
              onChange={(e) => setTerms({ ...terms, expiry: e.target.value })}
            >
              {rows
                .filter((r) => r.date > scenario.entry)
                .map((r) => (
                  <option value={r.date} key={r.date}>
                    {day(r.date)} — daily close replay
                  </option>
                ))}
            </select>
          </label>
          <label htmlFor="premium">
            Indicative total premium (demo USDC)
            <input
              id="premium"
              type="number"
              step="0.01"
              min="0"
              value={terms.premium}
              onChange={(e) => setTerms({ ...terms, premium: +e.target.value })}
            />
          </label>
          <div className="field-note">
            An illustration until the maker manually prices and funds your
            request.
          </div>
          {valid && (
            <p className="form-error" role="alert">
              {valid}
            </p>
          )}
          <Button className="primary full" disabled={!!valid} onClick={request}>
            Request a funded quote <ArrowRight size={15} />
          </Button>
          <span className="form-footer">
            <Lock size={12} />
            No cash moves when you request a quote.
          </span>
          <button
            className="chain-build-link"
            disabled={!!valid}
            onClick={() => setModal('execute')}
          >
            <LinkIcon size={13} />
            Try this contract on Solana <ArrowUpRight size={12} />
          </button>
        </section>
        <div className="builder-result">
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SEE THE TRADE-OFF</span>
                <h2>Your outcome at expiry</h2>
              </div>
              <button
                className={`toggle-label ${combined ? 'on' : ''}`}
                onClick={() => setCombined(!combined)}
              >
                <span className="toggle" />
                Include stock
              </button>
            </div>
            <PayoffChart terms={terms} entry={entry} combined={combined} />
            <div className="three-metrics">
              <Metric
                label="Maximum derivative loss"
                value={valid ? '—' : money(terms.premium)}
                note="Premium — zero demo fees"
              />
              <Metric
                label="Maximum derivative gain"
                value={valid ? '—' : money(maximum(terms) - terms.premium)}
                positive
                note="Payout less premium"
              />
              <Metric
                label="Derivative break-even"
                value={valid ? '—' : money(breakEven(terms) || 0)}
                note="At settlement"
              />
            </div>
          </section>
          <section className="panel protection-explainer">
            <div className="round-icon">
              <Shield size={19} />
            </div>
            <div>
              <h3>
                {terms.kind === 'put'
                  ? 'Your protection has a defined range.'
                  : 'Your upside has a defined ceiling.'}
              </h3>
              <p>
                {terms.kind === 'put'
                  ? `The hedge offsets declines from ${money(terms.high, 0)} to ${money(terms.low, 0)} per share. Below ${money(terms.low, 0)}, further stock losses resume. You pay the premium in every outcome.`
                  : `The call spread pays above ${money(terms.low, 0)}, up to ${money(terms.high - terms.low, 0)} per share. Above ${money(terms.high, 0)}, its payout stops increasing.`}
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>What secures this trade</h2>
              <Lock size={16} />
            </div>
            <div className="detail-row">
              <span>Maker reserves before acceptance</span>
              <strong>{valid ? '—' : money(maximum(terms))} USDC</strong>
            </div>
            <div className="detail-row">
              <span>Settlement policy</span>
              <strong>Historical daily close — v1</strong>
            </div>
            <div className="detail-row">
              <span>Source</span>
              <strong>Precommitted NVDA sample</strong>
            </div>
            <div className="detail-row">
              <span>Exit</span>
              <strong>Hold to settlement</strong>
            </div>
            <div className="detail-row">
              <span>Collateral reuse</span>
              <strong>Not permitted</strong>
            </div>
          </section>
          <div className="info-strip">
            <Info size={15} />
            <p>
              The derivative follows the underlying equity, not the token’s
              market price. Issuer failure and a token discount remain separate
              risks.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
