'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Lock, ShieldCheck } from 'lucide-react';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { ResolvedAsset } from '@/lib/preipo/types';
import {
  ACCEPTANCE_WINDOW_SECONDS,
  EXERCISE_WINDOW_SECONDS,
  parseUnits,
  summarise,
  validateTerms,
  type CoveredCallTerms,
} from '@/lib/preipo/terms';
import { AssetLogo } from './AssetLogo';
import { Scoreboard } from './Scoreboard';
import { Tape } from './Tape';
import {
  Badge,
  Button,
  Empty,
  Field,
  Line,
  Modal,
  Money,
  Panel,
  PanelHead,
  Stat,
  compact,
  usd,
} from './shared';

export type PreIpoTab = 'market' | 'underwrite';

interface AssetsPayload {
  network: string;
  programId: string | null;
  usdcMint: string | null;
  executionEnabled: boolean;
  assets: ResolvedAsset[];
  warnings: string[];
  refreshedAt: string;
}

const num = (v: unknown) => (typeof v === 'number' ? v : null);

const EXPLORER = (mint: string, network: string) =>
  `https://explorer.solana.com/address/${mint}${network === 'mainnet' ? '' : `?cluster=${network}`}`;

/** A blocker's code is a slug, not a sentence. */
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

/** The company, without the provider's naming attached to it. */
const company = (displayName: string) =>
  displayName.replace(/^Tessera T-/, '').replace(/ PreStocks$/, '');

export function PreIpoView({
  feed,
  tab,
  advanced,
}: {
  feed: MarkFeed;
  tab: PreIpoTab;
  advanced: boolean;
}) {
  const [data, setData] = useState<AssetsPayload | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/preipo/assets')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((d: AssetsPayload) => {
          if (!live) return;
          setData(d);
          setSelected(
            (current) =>
              current ||
              d.assets.find((a) => a.verdict.escrowSupported)?.asset.id ||
              d.assets[0]?.asset.id ||
              '',
          );
        })
        .catch((e) => live && setError((e as Error).message));
    void load();
    // The providers republish a mark on their own clock; re-reading keeps
    // the mock tokens anchored to it rather than drifting all session.
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (error)
    return (
      <Panel>
        <Empty
          title="Asset registry unavailable"
          description={`The verification service could not be reached (${error}). No asset can be offered until its mint is verified on chain.`}
        />
      </Panel>
    );

  if (!data)
    return (
      <Panel>
        <Empty
          title="Verifying mints"
          description="Reading each mint from the chain before anything is offered."
        />
      </Panel>
    );

  const current = data.assets.find((a) => a.asset.id === selected) || null;
  const escrowable = data.assets.filter((a) => a.verdict.escrowSupported);
  const blocked = data.assets.filter((a) => !a.verdict.escrowSupported);

  return tab === 'market' ? (
    <Market
      data={data}
      feed={feed}
      escrowable={escrowable}
      blocked={blocked}
      selected={selected}
      onSelect={setSelected}
    />
  ) : (
    <Underwrite
      data={data}
      feed={feed}
      current={current}
      escrowable={escrowable}
      onSelect={setSelected}
      advanced={advanced}
    />
  );
}

/* ---------------------------------------------------------------- */

function AssetRow({
  a,
  feed,
  selected,
  onSelect,
}: {
  a: ResolvedAsset;
  feed: MarkFeed;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = a.quote?.meta || {};
  const logo = typeof meta.image === 'string' ? meta.image : null;
  const sector = typeof meta.sector === 'string' ? meta.sector : null;
  const holders = num(meta.holders);
  const valuation = num(meta.markValuation) ?? num(meta.impliedValuation);
  const mark = feed.marks[a.asset.symbol];
  const price = mark?.price ?? a.quote?.markPriceUsd ?? null;

  return (
    <tr
      className={`od-market-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-selected={selected}
    >
      <td>
        <div className="od-asset-cell">
          <AssetLogo
            symbol={company(a.asset.displayName)}
            src={logo}
            size={34}
          />
          <div>
            <b>{company(a.asset.displayName)}</b>
            <small>
              {a.asset.issuerTerms.issuer}
              {sector ? `, ${sector}` : ''}
            </small>
          </div>
        </div>
      </td>
      <td className="num">{price != null ? usd(price) : '—'}</td>
      <td className={`num ${mark && mark.change >= 0 ? 'od-up' : 'od-down'}`}>
        {mark ? `${mark.change >= 0 ? '+' : ''}${(mark.change * 100).toFixed(2)}%` : '—'}
      </td>
      <td className="num">{valuation ? compact(valuation) : '—'}</td>
      <td className="num">
        {holders ? holders.toLocaleString('en-US') : '—'}
      </td>
      <td className="num">
        {mark ? `${mark.spreadBps} bps` : '—'}
      </td>
      <td>
        {a.verdict.escrowSupported ? (
          <Badge tone="green">
            <ShieldCheck size={12} /> Escrowable
          </Badge>
        ) : (
          <Badge tone="red">
            <Lock size={12} /> Blocked
          </Badge>
        )}
      </td>
    </tr>
  );
}

function Market({
  data,
  feed,
  escrowable,
  blocked,
  selected,
  onSelect,
}: {
  data: AssetsPayload;
  feed: MarkFeed;
  escrowable: ResolvedAsset[];
  blocked: ResolvedAsset[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const totalValuation = data.assets.reduce((t, a) => {
    const meta = a.quote?.meta || {};
    return t + (num(meta.markValuation) ?? num(meta.impliedValuation) ?? 0);
  }, 0);

  // Every rejected asset here fails for the same reasons, so the page
  // states them once for the group instead of eight times.
  const shared = [
    ...new Set(blocked.flatMap((a) => a.verdict.blockers.map((b) => b.code))),
  ].filter((code) =>
    blocked.every((a) => a.verdict.blockers.some((b) => b.code === code)),
  );

  return (
    <>
      <div className="od-grid-4">
        <Panel>
          <Stat
            label="Companies listed"
            value={String(data.assets.length)}
            detail={`${escrowable.length} escrowable`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Combined valuation"
            value={compact(totalValuation)}
            detail="As published by the sponsors"
          />
        </Panel>
        <Panel>
          <Stat
            label="Rejected by their mint"
            value={String(blocked.length)}
            detail={
              shared.length
                ? (BLOCKER_LABEL[shared[0]] || shared[0]).toLowerCase()
                : 'Mixed reasons'
            }
            tone={blocked.length ? 'negative' : ''}
          />
        </Panel>
        <Panel>
          <Stat
            label="Verified against"
            value={data.network}
            detail="Read from each mint account"
          />
        </Panel>
      </div>

      {data.warnings.map((w) => (
        <Panel key={w} tone="warn">
          <div className="od-panel-body od-note">
            <AlertTriangle size={15} />
            <p>{w}</p>
          </div>
        </Panel>
      ))}

      <Panel>
        <PanelHead
          title="Pre-IPO market"
          description="Sponsor-issued tokens tracking private companies. Quantities are tokens, never company shares."
          action={
            <Badge tone={feed.connected ? 'green' : 'neutral'}>
              {feed.connected ? 'Marks live' : 'Marks simulated'}
            </Badge>
          }
        />
        <div className="od-table-wrap">
          <table className="od-table od-market-table">
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Mark</th>
                <th className="num">Today</th>
                <th className="num">Valuation</th>
                <th className="num">Holders</th>
                <th className="num">Spread</th>
                <th>Escrow</th>
              </tr>
            </thead>
            <tbody>
              {[...escrowable, ...blocked].map((a) => (
                <AssetRow
                  key={a.asset.id}
                  a={a}
                  feed={feed}
                  selected={a.asset.id === selected}
                  onSelect={() => onSelect(a.asset.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="od-panel-foot">
          <span>
            A token whose issuer can move it out of escrow cannot back a
            contract, whatever it is worth.
          </span>
          <span>Refreshed {new Date(data.refreshedAt).toLocaleTimeString()}</span>
        </div>
      </Panel>

      <Tape
        feed={feed}
        title="Maker activity"
        description="Mock tokens minted on a buy and burned on a sell, pegged to each sponsor's published mark."
      />
    </>
  );
}

/* ---------------------------------------------------------------- */

function Underwrite({
  data,
  feed,
  current,
  escrowable,
  onSelect,
  advanced,
}: {
  data: AssetsPayload;
  feed: MarkFeed;
  current: ResolvedAsset | null;
  escrowable: ResolvedAsset[];
  onSelect: (id: string) => void;
  advanced: boolean;
}) {
  const [amount, setAmount] = useState('0.25');
  const [premium, setPremium] = useState('6.50');
  const [exercise, setExercise] = useState('225.00');
  const [confirm, setConfirm] = useState(false);
  // Pinned once so re-renders cannot shift the deadlines under the user.
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000));

  const mark = current ? feed.marks[current.asset.symbol] : undefined;
  const spot = mark?.price ?? current?.quote?.markPriceUsd ?? null;

  const decimals =
    current?.onchain?.decimals ?? current?.asset.expectedDecimals ?? 9;

  const { summary, termsError } = useMemo(() => {
    if (!current) return { summary: null, termsError: '' };
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
      return { summary: summarise(terms, decimals), termsError: '' };
    } catch (e) {
      return { summary: null, termsError: (e as Error).message };
    }
  }, [current, data.usdcMint, amount, exercise, premium, openedAt, decimals]);

  if (!current)
    return (
      <Panel>
        <Empty
          title="Pick a company first"
          description="Choose an escrowable token on the Market tab, then come back to write against it."
        />
      </Panel>
    );

  const reasons = [
    ...current.verdict.blockers,
    ...current.registryMismatch.map((detail) => ({
      code: 'registry-mismatch',
      detail,
    })),
  ];

  const strike = summary ? Number(summary.derivedStrikePerToken) : null;
  const tokens = Number(amount) || 0;
  const keep = Number(premium) || 0;
  const exercised = keep + (Number(exercise) || 0);
  // What the seller gives up above the strike: the tokens go at the
  // strike however far the mark runs past it.
  const capped = spot != null && strike != null;

  return (
    <div className="od-work">
      <Panel className="od-ticket">
        <PanelHead
          title="Write a covered call"
          action={<Badge tone="accent">{current.asset.symbol}</Badge>}
        />
        <div className="od-panel-body">
          <Field label="Company">
            <select
              value={current.asset.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {escrowable.map((a) => (
                <option key={a.asset.id} value={a.asset.id}>
                  {company(a.asset.displayName)} ({a.asset.issuerTerms.issuer})
                </option>
              ))}
            </select>
          </Field>

          {!current.verdict.escrowSupported ? (
            <>
              <p className="od-note">
                Not escrowable in this version. {reasons.length} mint feature
                {reasons.length === 1 ? '' : 's'} read from the mint account
                cannot be guaranteed to a buyer.
              </p>
              <ul className="od-reasons">
                {reasons.map((b) => (
                  <li key={b.code + b.detail}>
                    <Lock size={13} />
                    <div>
                      <b>{BLOCKER_LABEL[b.code] || b.code}</b>
                      <small>{b.detail}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <Field
                label={`Tokens to escrow`}
                hint={spot != null ? `Mark ${usd(spot)}` : undefined}
              >
                <input
                  aria-label="Tokens to escrow"
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

              <Scoreboard
                risk={0}
                reward={exercised}
                capped
                breakEven={[]}
                premium={-keep}
                invalid={!summary}
              />

              <div className="od-lines">
                <Line
                  label="Derived strike per token"
                  value={summary ? `$${summary.derivedStrikePerToken}` : '—'}
                />
                <Line
                  label="Against the live mark"
                  value={
                    capped && strike
                      ? `${(((strike as number) / (spot as number)) - 1 >= 0 ? '+' : '')}${((((strike as number) / (spot as number)) - 1) * 100).toFixed(1)}%`
                      : '—'
                  }
                  tone="muted"
                />
                <Line
                  label="Tokens escrowed"
                  value={
                    summary
                      ? `${summary.underlyingAmount} ${current.asset.symbol}`
                      : '—'
                  }
                />
              </div>

              {termsError && (
                <p className="od-error" role="alert">
                  {termsError}
                </p>
              )}
              <Button
                size="lg"
                full
                disabled={!summary}
                onClick={() => setConfirm(true)}
              >
                Review covered call
              </Button>
            </>
          )}
        </div>
      </Panel>

      <div className="od-insight">
        <Panel>
          <PanelHead
            title="What happens at expiry"
            description={
              summary
                ? `Two outcomes, both fixed the moment you sign.`
                : 'Set the terms to price both outcomes.'
            }
            action={
              summary && (
                <Badge tone="accent">
                  Strike ${summary.derivedStrikePerToken}
                </Badge>
              )
            }
          />
          {summary ? (
            <>
              <div className="od-panel-body od-outcomes">
                <div className="od-outcome">
                  <span>Above ${summary.derivedStrikePerToken}</span>
                  <strong>
                    <Money value={exercised} />
                  </strong>
                  <small>
                    The buyer exercises. You deliver{' '}
                    {summary.underlyingAmount} {current.asset.symbol} and keep
                    both the premium and the exercise payment.
                  </small>
                </div>
                <div className="od-outcome keep">
                  <span>At or below ${summary.derivedStrikePerToken}</span>
                  <strong className="up">
                    <Money value={keep} />
                  </strong>
                  <small>
                    It expires. You keep the premium and all{' '}
                    {summary.underlyingAmount} {current.asset.symbol}.
                  </small>
                </div>
              </div>

              <div className="od-panel-body">
                <OutcomeChart
                  tokens={tokens}
                  strike={Number(summary.derivedStrikePerToken)}
                  premium={keep}
                  spot={spot ?? Number(summary.derivedStrikePerToken)}
                />
              </div>
            </>
          ) : (
            <Empty
              title="Set the terms to price it"
              description="Enter a token quantity, a premium and an exercise payment to see both outcomes."
            />
          )}

          {current.onchain &&
            current.verdict.disclosures.map((d) => (
              <div className="od-panel-body" key={d}>
                <p className="od-note">
                  <AlertTriangle size={13} /> {d}
                </p>
              </div>
            ))}

          {current.onchain && (
            <div className="od-panel-foot">
              <span>Verified on chain</span>
              <a
                className="od-link"
                href={EXPLORER(current.asset.mint, data.network)}
                target="_blank"
                rel="noreferrer"
              >
                {current.asset.mint.slice(0, 6)}…{current.asset.mint.slice(-6)}
                <ExternalLink size={13} />
              </a>
            </div>
          )}
        </Panel>

        {advanced && (
          <Panel>
            <PanelHead
              title="Issuer terms"
              description="What the sponsor keeps the right to do, read from its own documentation."
            />
            <div className="od-panel-body">
              <p className="od-note">{current.asset.issuerTerms.instrument}</p>
              <h3 className="od-subhead">Rights the issuer retains</h3>
              <ul className="od-bullets">
                {current.asset.issuerTerms.issuerRights.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <h3 className="od-subhead">Restrictions</h3>
              <ul className="od-bullets">
                {current.asset.issuerTerms.restrictions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <a
                className="od-link"
                href={current.asset.issuerTerms.reference}
                target="_blank"
                rel="noreferrer"
              >
                Issuer documentation <ExternalLink size={13} />
              </a>
            </div>
          </Panel>
        )}
      </div>

      {confirm && summary && (
        <Modal
          title="Confirm covered call"
          description="Read every figure. Once signed, the terms are immutable."
          onClose={() => setConfirm(false)}
        >
          <div className="od-lines">
            <Line label="Underlying mint" value={current.asset.mint} />
            <Line
              label="Tokens escrowed"
              value={`${summary.underlyingAmount} ${current.asset.symbol}`}
            />
            <Line label="Total premium" value={`${summary.totalPremium} USDC`} />
            <Line
              label="Total exercise payment"
              value={`${summary.totalExercisePayment} USDC`}
            />
            <Line
              label="Derived strike per token"
              value={`$${summary.derivedStrikePerToken}`}
            />
            <Line label="Network" value={data.network} />
          </div>
          <p className="od-note">
            You keep the {summary.totalPremium} USDC premium whatever happens,
            you keep all downside on the tokens, and your upside is capped:
            above the strike the buyer takes every token for{' '}
            {summary.totalExercisePayment} USDC. A buyer who never exercises
            loses their whole {summary.buyerMaxLoss} USDC premium.
          </p>
          <p className="od-note">An offer with no funded buyer stays unfilled.</p>
          <Button full disabled>
            Connect wallet to sign
          </Button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const O = { w: 760, h: 220, x0: 62, x1: 748, y0: 18, y1: 176, axisY: 202 };

/**
 * The seller's payoff on a pre-IPO covered call.
 *
 * The screen described two outcomes in prose and never drew the line
 * between them, which is the part that shows what is actually being
 * sold: everything above the strike.
 */
function OutcomeChart({
  tokens,
  strike,
  premium,
  spot,
}: {
  tokens: number;
  strike: number;
  premium: number;
  spot: number;
}) {
  const lo = Math.min(spot, strike) * 0.55,
    hi = Math.max(spot, strike) * 1.55;
  const rows = Array.from({ length: 101 }, (_, i) => {
    const price = lo + ((hi - lo) * i) / 100;
    // Tokens held plus premium, capped at the strike.
    const value = tokens * Math.min(price, strike) + premium;
    return { price, value };
  });
  const hold = rows.map((r) => ({ price: r.price, value: tokens * r.price }));

  const min = 0;
  const max = Math.max(...hold.map((h) => h.value), 1e-9);
  const x = (v: number) => O.x0 + ((v - lo) / (hi - lo)) * (O.x1 - O.x0);
  const y = (v: number) =>
    O.y0 + ((max - v) / (max - min || 1)) * (O.y1 - O.y0);
  const line = (pts: { price: number; value: number }[]) =>
    pts
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.price).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');

  return (
    <svg
      className="od-outcome-chart"
      viewBox={`0 0 ${O.w} ${O.h}`}
      aria-label="Value of the escrowed tokens against the covered call, at expiry"
    >
      <g className="od-chart-grid">
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              x1={O.x0}
              x2={O.x1}
              y1={O.y0 + n * (O.y1 - O.y0)}
              y2={O.y0 + n * (O.y1 - O.y0)}
            />
            <text x={O.x0 - 10} y={O.y0 + n * (O.y1 - O.y0) + 4} textAnchor="end">
              {usd(max - (max - min) * n, 0)}
            </text>
          </g>
        ))}
      </g>
      <path d={line(hold)} className="od-outcome-hold" />
      <path d={line(rows)} className="od-chart-line" />
      <g className="od-chart-strikes">
        <line x1={x(strike)} x2={x(strike)} y1={O.y0} y2={O.y1} />
        <text x={x(strike)} y={O.y0 - 4} textAnchor="middle">
          strike {usd(strike, 0)}
        </text>
      </g>
      <g className="od-chart-spot">
        <line x1={x(spot)} x2={x(spot)} y1={O.y0} y2={O.y1} />
      </g>
      <g className="od-chart-ticks">
        <text x={O.x0} y={O.axisY} textAnchor="start">
          {usd(lo, 0)}
        </text>
        <text x={x(spot)} y={O.axisY} textAnchor="middle">
          mark {usd(spot, 0)}
        </text>
        <text x={O.x1} y={O.axisY} textAnchor="end">
          {usd(hi, 0)}
        </text>
      </g>
    </svg>
  );
}
