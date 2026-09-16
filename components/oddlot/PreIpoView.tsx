'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Lock, ShieldCheck } from 'lucide-react';
import type { ResolvedAsset } from '@/lib/preipo/types';
import {
  ACCEPTANCE_WINDOW_SECONDS,
  EXERCISE_WINDOW_SECONDS,
  parseUnits,
  summarise,
  validateTerms,
  type CoveredCallTerms,
} from '@/lib/preipo/terms';
import { Badge, Button, Empty, Field, Heading, Panel, Modal } from './shared';

interface AssetsPayload {
  network: string;
  programId: string | null;
  usdcMint: string | null;
  executionEnabled: boolean;
  assets: ResolvedAsset[];
  warnings: string[];
  refreshedAt: string;
}

const EXPLORER = (mint: string, network: string) =>
  `https://explorer.solana.com/address/${mint}${network === 'mainnet' ? '' : `?cluster=${network}`}`;

/** A blocker's code is a slug, not a sentence. Name each one in a few
 *  words so the list scans; the full reason stays one click away. */
const BLOCKER_LABEL: Record<string, string> = {
  'permanent-delegate': 'Issuer can move escrowed tokens',
  pausable: 'Issuer can pause transfers',
  'transfer-hook': 'Transfers run issuer code',
  'non-transferable': 'Token cannot be transferred',
  'confidential-transfer': 'Balances not publicly verifiable',
  'mutable-ui-multiplier': 'Issuer can rescale displayed amounts',
  'unknown-extension': 'Unrecognised mint extension',
  'unsupported-token-program': 'Unsupported token program',
  'decimals-out-of-range': 'Decimals outside supported range',
  'registry-mismatch': 'On-chain state differs from the registry',
};

export function PreIpoView() {
  const [data, setData] = useState<AssetsPayload | null>(null),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string>(''),
    [amount, setAmount] = useState('0.25'),
    [premium, setPremium] = useState('6.50'),
    [exercise, setExercise] = useState('225.00'),
    [confirm, setConfirm] = useState(false),
    // Pinned once so re-renders cannot shift the deadlines under the user.
    [openedAt] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let live = true;
    fetch('/api/preipo/assets')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: AssetsPayload) => {
        if (!live) return;
        setData(d);
        setSelected(
          d.assets.find((a) => a.verdict.escrowSupported)?.asset.id ||
            d.assets[0]?.asset.id ||
            '',
        );
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, []);

  if (error)
    return (
      <>
        <Heading
          eyebrow="PRE-IPO OPTIONS"
          title="Covered calls on sponsor tokens."
          description="Verification could not complete."
        />
        <Panel>
          <Empty
            title="Asset registry unavailable."
            description={`The verification service could not be reached (${error}). No asset can be offered until its mint is verified on chain.`}
          />
        </Panel>
      </>
    );

  if (!data)
    return (
      <>
        <Heading
          eyebrow="PRE-IPO OPTIONS"
          title="Covered calls on sponsor tokens."
          description="Reading each mint from the chain."
        />
        <Panel>
          <Empty
            title="Verifying mints…"
            description="Reading each mint from the chain before anything is offered."
          />
        </Panel>
      </>
    );

  const current = data.assets.find((a) => a.asset.id === selected) || null;
  // Blockers and registry mismatches are the same thing to a reader: a
  // reason this mint cannot be escrowed. Show them as one list.
  const reasons = current
    ? [
        ...current.verdict.blockers,
        ...current.registryMismatch.map((detail) => ({
          code: 'registry-mismatch',
          detail,
        })),
      ]
    : [];
  const decimals =
    current?.onchain?.decimals ?? current?.asset.expectedDecimals ?? 9;

  let summary: ReturnType<typeof summarise> | null = null;
  let termsError = '';
  if (current)
    try {
      const terms: CoveredCallTerms = validateTerms({
        underlyingMint: current.asset.mint,
        usdcMint: data.usdcMint || 'USDC-NOT-CONFIGURED',
        underlyingAmount: parseUnits(amount, decimals),
        totalExercisePayment: parseUnits(exercise, 6),
        totalPremium: parseUnits(premium, 6),
        acceptanceDeadline: openedAt + ACCEPTANCE_WINDOW_SECONDS,
        exerciseExpiry: openedAt + EXERCISE_WINDOW_SECONDS,
        designatedBuyer: null,
      });
      summary = summarise(terms, decimals);
      termsError = '';
    } catch (e) {
      termsError = (e as Error).message;
    }

  return (
    <>
      <Heading
        eyebrow="PRE-IPO OPTIONS"
        title="Covered calls on sponsor tokens."
        description="Write a fractional, physically settled covered call against tokens you already hold. Quantities are tokens, never company shares."
      />

      {data.warnings.map((w) => (
        <Panel key={w} className="od-notice warn">
          <AlertTriangle size={15} />
          <p>{w}</p>
        </Panel>
      ))}

      <Panel>
        <div className="od-panel-heading">
          <h2>Verified assets</h2>
          <Badge tone="neutral">
            {data.assets.filter((a) => a.verdict.escrowSupported).length} of{' '}
            {data.assets.length} escrowable
          </Badge>
        </div>
        <div className="od-panel-body">
          <div className="od-preipo-assets">
            {data.assets.map((a) => (
              <button
                key={a.asset.id}
                className={`od-preipo-asset ${a.asset.id === selected ? 'selected' : ''} ${a.verdict.escrowSupported ? '' : 'blocked'}`}
                aria-pressed={a.asset.id === selected}
                onClick={() => setSelected(a.asset.id)}
              >
                <span className="od-preipo-provider">
                  {a.asset.issuerTerms.issuer}
                </span>
                <strong>{a.asset.displayName}</strong>
                <span className="od-preipo-mint">
                  {a.asset.mint.slice(0, 6)}…{a.asset.mint.slice(-6)}
                </span>
                <span className="od-preipo-status">
                  {a.verdict.escrowSupported ? (
                    <>
                      <ShieldCheck size={13} /> Escrowable
                    </>
                  ) : (
                    <>
                      <Lock size={13} /> Not escrowable
                    </>
                  )}
                </span>
                {a.quote?.markPriceUsd !== null && a.quote && (
                  <span className="od-preipo-price">
                    ${a.quote.markPriceUsd?.toFixed(2)} indicative
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {current && (
        <div className="od-builder-grid">
          <Panel className="od-order-form">
            <div className="od-panel-heading">
              <h2>Write a covered call</h2>
              <Badge tone="neutral">{current.asset.symbol}</Badge>
            </div>

            {!current.verdict.escrowSupported ? (
              <div className="od-panel-body">
                <p className="od-form-note">
                  Not escrowable in this version. {reasons.length} mint feature
                  {reasons.length === 1 ? '' : 's'} read from the mint account
                  cannot be guaranteed to a buyer:
                </p>
                <ul className="od-reason-list">
                  {reasons.map((b) => (
                    <li key={b.code + b.detail}>
                      <Lock size={13} />
                      <span>{BLOCKER_LABEL[b.code] || b.code}</span>
                      <code>{b.code}</code>
                    </li>
                  ))}
                </ul>
                <details className="od-sizing od-terms">
                  <summary>Why each one blocks escrow</summary>
                  <div className="od-terms-body">
                    {reasons.map((b) => (
                      <p className="od-form-note" key={b.code + b.detail}>
                        <b>{BLOCKER_LABEL[b.code] || b.code}.</b> {b.detail}
                      </p>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <div className="od-form-content">
                <Field label={`Tokens to escrow (${current.asset.symbol})`}>
                  <input
                    value={amount}
                    inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <Field label="Total premium (USDC)">
                  <input
                    value={premium}
                    inputMode="decimal"
                    onChange={(e) => setPremium(e.target.value)}
                  />
                </Field>
                <Field
                  label="Total exercise payment (USDC)"
                  help="The contract stores totals. The strike per token is derived from them for display and is never the settlement figure."
                >
                  <input
                    value={exercise}
                    inputMode="decimal"
                    onChange={(e) => setExercise(e.target.value)}
                  />
                </Field>
                <div className="od-order-summary">
                  <div>
                    <span>Derived strike per token</span>
                    <b>{summary ? `$${summary.derivedStrikePerToken}` : '—'}</b>
                  </div>
                  <div>
                    <span>Premium you keep</span>
                    <b>{summary ? `${summary.totalPremium} USDC` : '—'}</b>
                  </div>
                  <div>
                    <span>Paid to you if exercised</span>
                    <b>
                      {summary ? `${summary.totalExercisePayment} USDC` : '—'}
                    </b>
                  </div>
                  <div>
                    <span>Tokens escrowed</span>
                    <b>
                      {summary
                        ? `${summary.underlyingAmount} ${current.asset.symbol}`
                        : '—'}
                    </b>
                  </div>
                </div>
                {termsError && <p className="od-preipo-error">{termsError}</p>}
                <Button disabled={!summary} onClick={() => setConfirm(true)}>
                  Review covered call
                </Button>
              </div>
            )}
          </Panel>

          <div className="od-builder-insight">
            <Panel>
              <div className="od-panel-heading">
                <h2>What happens at expiry</h2>
                <Badge tone="neutral">
                  {summary
                    ? `Strike $${summary.derivedStrikePerToken}`
                    : 'Set terms'}
                </Badge>
              </div>
              {summary ? (
                <div className="od-outcomes">
                  <div className="od-outcome">
                    <span className="od-outcome-when">
                      Above ${summary.derivedStrikePerToken} · buyer exercises
                    </span>
                    <strong>{summary.sellerReceivesIfExercised} USDC</strong>
                    <small>
                      You deliver {summary.underlyingAmount}{' '}
                      {current.asset.symbol}. Premium and exercise payment are
                      both yours.
                    </small>
                  </div>
                  <div className="od-outcome keep">
                    <span className="od-outcome-when">
                      At or below ${summary.derivedStrikePerToken} · it expires
                    </span>
                    <strong>{summary.sellerKeepsIfUnexercised} USDC</strong>
                    <small>
                      You keep the premium and all {summary.underlyingAmount}{' '}
                      {current.asset.symbol}.
                    </small>
                  </div>
                </div>
              ) : (
                <Empty
                  title="Set the terms to price it."
                  description="Enter a token quantity, a premium and an exercise payment to see both outcomes."
                />
              )}
              {current.onchain &&
                current.verdict.disclosures.map((d) => (
                  <p className="od-form-note disclosure od-inset" key={d}>
                    <AlertTriangle size={13} /> {d}
                  </p>
                ))}
              <div className="od-terms-strip">
                <details className="od-sizing od-terms">
                  <summary>Issuer terms and restrictions</summary>
                  <div className="od-terms-body">
                    <p className="od-form-note">
                      {current.asset.issuerTerms.instrument}
                    </p>
                    <h3 className="od-preipo-subhead">
                      Rights the issuer retains
                    </h3>
                    <ul className="od-preipo-list">
                      {current.asset.issuerTerms.issuerRights.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <h3 className="od-preipo-subhead">Restrictions</h3>
                    <ul className="od-preipo-list">
                      {current.asset.issuerTerms.restrictions.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <a
                      className="od-external"
                      href={current.asset.issuerTerms.reference}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Issuer docs <ExternalLink size={13} />
                    </a>
                  </div>
                </details>
              </div>
              {current.onchain && (
                <div className="od-panel-foot od-basis">
                  <span>Verified on chain</span>
                  <span>
                    <a
                      className="od-external"
                      href={EXPLORER(current.asset.mint, data.network)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {current.asset.mint.slice(0, 6)}…
                      {current.asset.mint.slice(-6)}
                    </a>{' '}
                    · {current.onchain.decimals} decimals ·{' '}
                    {current.onchain.network}
                  </span>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {confirm && current && summary && (
        <Modal
          title="Confirm covered call"
          description="Read every figure. Once signed, the terms are immutable."
          onClose={() => setConfirm(false)}
        >
          <div className="od-review-lines">
            <div className="od-review-line">
              <span>Underlying mint</span>
              <b className="od-mono">{current.asset.mint}</b>
            </div>
            <div className="od-review-line">
              <span>Tokens escrowed</span>
              <b>
                {summary.underlyingAmount} {current.asset.symbol}
              </b>
            </div>
            <div className="od-review-line">
              <span>Total premium</span>
              <b>{summary.totalPremium} USDC</b>
            </div>
            <div className="od-review-line">
              <span>Total exercise payment</span>
              <b>{summary.totalExercisePayment} USDC</b>
            </div>
            <div className="od-review-line">
              <span>Derived strike per token</span>
              <b>${summary.derivedStrikePerToken}</b>
            </div>
            <div className="od-review-line">
              <span>Network</span>
              <b>{data.network}</b>
            </div>
          </div>
          <p className="od-form-note">
            As the seller you keep the {summary.totalPremium} USDC premium
            whatever happens, you keep all downside on the tokens, and your
            upside is capped: above the strike the buyer takes every token for{' '}
            {summary.totalExercisePayment} USDC. A buyer who never exercises
            loses their whole {summary.buyerMaxLoss} USDC premium.
          </p>
          <p className="od-form-note">
            An offer with no funded buyer stays unfilled.
          </p>
          <Button disabled>Connect wallet to sign</Button>
        </Modal>
      )}
    </>
  );
}
