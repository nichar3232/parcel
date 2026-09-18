'use client';
import { useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ExternalLink,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import {
  company,
  usePreIpoAssets,
  type AssetsPayload,
} from '@/hooks/oddlot/use-preipo';
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
  compact,
  usd,
} from './shared';

export type PreIpoTab = 'market' | 'underwrite';

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
export function PreIpoView({
  feed,
  tab,
  openTrade,
  openUnderwrite,
  pick,
}: {
  feed: MarkFeed;
  tab: PreIpoTab;
  openTrade: () => void;
  /** Take the reader to the ticket for whatever they just picked. */
  openUnderwrite: () => void;
  /** An asset chosen elsewhere, such as the portfolio's market strip. */
  pick?: string;
}) {
  const { data, error } = usePreIpoAssets();
  const [chosen, setChosen] = useState(pick ?? '');
  // A pick made elsewhere wins over the last choice made here, once.
  const [seenPick, setSeenPick] = useState(pick);
  if (pick !== seenPick) {
    setSeenPick(pick);
    if (pick) setChosen(pick);
  }
  // What the ticket shows: the choice, or the first escrowable asset.
  const selected =
    chosen ||
    data?.assets.find((a) => a.verdict.escrowSupported)?.asset.id ||
    data?.assets[0]?.asset.id ||
    '';
  const setSelected = setChosen;

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
      onSelect={(id) => {
        // A row is a choice, not a highlight: picking a company opens
        // its ticket, and a blocked one opens the reasons it is blocked.
        setSelected(id);
        openUnderwrite();
      }}
    />
  ) : (
    <Underwrite
      data={data}
      feed={feed}
      current={current}
      onSelect={setSelected}
      openTrade={openTrade}
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
  const logo =
    typeof meta.image === 'string' ? meta.image : (a.asset.logo ?? null);
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
        {mark
          ? `${mark.change >= 0 ? '+' : ''}${(mark.change * 100).toFixed(2)}%`
          : '—'}
      </td>
      <td className="num">{valuation ? compact(valuation) : '—'}</td>
      <td className="num">{holders ? holders.toLocaleString('en-US') : '—'}</td>
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
  return (
    <>
      {/* The table counts its own rows, and every one of them prints a
          valuation and whether it is escrowable. A rail summing the
          column directly beneath it is the same fact, twice. */}
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
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- */

function Underwrite({
  data,
  feed,
  current,
  onSelect,
  openTrade,
}: {
  data: AssetsPayload;
  feed: MarkFeed;
  current: ResolvedAsset | null;
  onSelect: (id: string) => void;
  openTrade: () => void;
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
              {/* Every company the market lists, so the picker always
                  reads what the ticket is showing; a blocked one says so. */}
              {data.assets.map((a) => (
                <option key={a.asset.id} value={a.asset.id}>
                  {company(a.asset.displayName)} ({a.asset.issuerTerms.issuer})
                  {a.verdict.escrowSupported ? '' : ' — blocked'}
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
              <Field label="Total exercise payment (USDC)">
                <input
                  value={exercise}
                  inputMode="decimal"
                  onChange={(e) => setExercise(e.target.value)}
                />
              </Field>

              <div className="od-lines">
                <Line
                  label="Derived strike per token"
                  value={summary ? `$${summary.derivedStrikePerToken}` : '—'}
                />
                <Line
                  label="Against the live mark"
                  value={
                    capped && strike
                      ? `${(strike as number) / (spot as number) - 1 >= 0 ? '+' : ''}${(((strike as number) / (spot as number) - 1) * 100).toFixed(1)}%`
                      : '—'
                  }
                  tone="muted"
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
              <button className="od-chain-cue" onClick={openTrade}>
                <ArrowLeftRight size={15} />
                Writing against NVDA instead? That underwrites on the trade
                desk, out of the same vault.
              </button>
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
                    The buyer exercises. You deliver {summary.underlyingAmount}{' '}
                    {current.asset.symbol} and keep both the premium and the
                    exercise payment.
                  </small>
                </div>
                <div className="od-outcome">
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
                  symbol={current.asset.symbol}
                />
              </div>
            </>
          ) : (
            <Empty
              title="Set the terms to price it"
              description="Enter a token quantity, a premium and an exercise payment to see both outcomes."
            />
          )}

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

        {/* "Advanced" on this page revealed exactly one panel of
            issuer terms, which is not a mode, it is a panel. The rights
            the issuer keeps are on the confirm step with the rest of
            the disclosures, next to a link to its documentation. */}
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
            <Line
              label="Total premium"
              value={`${summary.totalPremium} USDC`}
            />
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
          <p className="od-note">
            An offer with no funded buyer stays unfilled.
          </p>
          {/* What the issuer can still do to this mint. These used to
              sit under the chart on the page behind, which is where
              three warning triangles stop being read. This is the last
              screen before a signature, so it is where they belong. */}
          {current.verdict.disclosures.map((d) => (
            <p className="od-note" key={d}>
              <AlertTriangle size={13} /> {d}
            </p>
          ))}
          <a
            className="od-link"
            href={current.asset.issuerTerms.reference}
            target="_blank"
            rel="noreferrer"
          >
            Issuer documentation <ExternalLink size={13} />
          </a>
          <Button full disabled>
            Connect wallet to sign
          </Button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

/* The frame the trade desk's payoff chart draws in, so the two charts
   read as one instrument rather than two drawings. */
const O = {
  w: 880,
  h: 272,
  x0: 68,
  x1: 858,
  /** the band above the plot, where the strike label lives */
  y0: 34,
  y1: 228,
  axisY: 254,
} as const;
const SAMPLES = 121;

const path = (points: [number, number][]) =>
  points
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

/**
 * What the escrowed tokens are worth at expiry, with and without the call.
 *
 * Two lines: holding the tokens, and holding them with the call written
 * against them. Below the strike the second sits above the first by
 * exactly the premium; above it the first keeps climbing and the second
 * goes flat. The band between them is the whole trade — the premium
 * kept on one side, the upside given up on the other — and it is
 * filled so the reader sees the trade before reading a number.
 *
 * The old drawing had neither fill nor legend, and its strike and mark
 * rules were the same grey dashes, so a reader could not tell which
 * line was which or what the gap between them cost. A pointer over the
 * plot now moves the readout, so "what if it ends at $X" is answered by
 * pointing at $X.
 */
function OutcomeChart({
  tokens,
  strike,
  premium,
  spot,
  symbol,
}: {
  tokens: number;
  strike: number;
  premium: number;
  spot: number;
  symbol: string;
}) {
  const uid = useId().replaceAll(':', '');
  const svg = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);

  const hold = (p: number) => tokens * p;
  const written = (p: number) => tokens * Math.min(p, strike) + premium;

  const plot = useMemo(() => {
    const hold = (p: number) => tokens * p;
    const written = (p: number) => tokens * Math.min(p, strike) + premium;
    const lo = Math.min(spot, strike) * 0.55,
      hi = Math.max(spot, strike) * 1.55;
    // The top of the axis is the top of the hold line rounded up to a
    // step a reader can count in, so the gridlines read $100, $200
    // rather than $87, $174.
    const top = Math.max(hold(hi), written(hi), 1e-9);
    const mag = 10 ** Math.floor(Math.log10(top / 4));
    const step =
      [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= top / 4) ??
      mag * 10;
    const max = Math.ceil(top / step) * step;
    const x = (p: number) => O.x0 + ((p - lo) / (hi - lo)) * (O.x1 - O.x0);
    const y = (v: number) => O.y0 + ((max - v) / max) * (O.y1 - O.y0);
    const prices = Array.from(
      { length: SAMPLES },
      (_, i) => lo + ((hi - lo) * i) / (SAMPLES - 1),
    );
    const pt = (p: number, v: number) => [x(p), y(v)] as [number, number];

    // The band between the lines, cut at the strike: to its left the
    // written line is on top by the premium, to its right the hold
    // line runs away above it.
    const k = Math.min(hi, Math.max(lo, strike));
    const left = [...prices.filter((p) => p < k), k];
    const right = [k, ...prices.filter((p) => p > k)];
    const band = (ps: number[]) =>
      `${path([
        ...ps.map((p) => pt(p, written(p))),
        ...ps.reverse().map((p) => pt(p, hold(p))),
      ])} Z`;

    return {
      lo,
      hi,
      x,
      y,
      holdLine: path(prices.map((p) => pt(p, hold(p)))),
      writtenLine: path(prices.map((p) => pt(p, written(p)))),
      cushion: band(left),
      given: band(right),
      grid: [0, 0.25, 0.5, 0.75, 1].map((n) => ({
        y: O.y0 + n * (O.y1 - O.y0),
        label: usd(max - max * n, 0),
      })),
    };
  }, [tokens, strike, premium, spot]);

  const price = at ?? spot;
  const withCall = written(price);
  const holding = hold(price);
  const diff = withCall - holding;
  const cx = plot.x(price);

  /** Map a pointer anywhere over the plot onto a price. */
  const scrub = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((clientX - box.left) / box.width) * O.w;
    const t = (Math.min(O.x1, Math.max(O.x0, vx)) - O.x0) / (O.x1 - O.x0);
    setAt(plot.lo + t * (plot.hi - plot.lo));
  };

  return (
    <div className="od-payoff od-outcome-plot">
      <div className="od-payoff-head">
        <div>
          <span>Value at expiry</span>
          <b>
            Your {tokens} {symbol}, if you sell this call
          </b>
        </div>
        <div className="od-payoff-read">
          <span>
            {at == null ? 'At the mark, ' : 'If it ends at '}
            {usd(price)}
          </span>
          <b>{usd(withCall)}</b>
          <small className={diff >= 0 ? 'up' : 'down'}>
            {diff >= 0 ? '+' : '−'}
            {usd(Math.abs(diff))} vs doing nothing
          </small>
        </div>
      </div>

      <svg
        ref={svg}
        className="od-payoff-svg od-outcome-chart"
        viewBox={`0 0 ${O.w} ${O.h}`}
        aria-label="What the escrowed tokens are worth at expiry if you sell this call, against doing nothing"
        onPointerMove={(e) => e.buttons !== 2 && scrub(e.clientX)}
        onPointerDown={(e) => scrub(e.clientX)}
        onPointerLeave={() => setAt(null)}
      >
        <g className="od-chart-grid">
          {plot.grid.map((g) => (
            <g key={g.label + g.y}>
              <line x1={O.x0} x2={O.x1} y1={g.y} y2={g.y} />
              <text x={O.x0 - 12} y={g.y + 4} textAnchor="end">
                {g.label}
              </text>
            </g>
          ))}
        </g>

        <path d={plot.cushion} className="od-outcome-cushion" />
        <path d={plot.given} className="od-outcome-given" />

        <g className="od-chart-strikes">
          <line x1={plot.x(strike)} x2={plot.x(strike)} y1={O.y0} y2={O.y1} />
          <text x={plot.x(strike)} y={O.y0 - 12} textAnchor="middle">
            Strike {usd(strike, 0)}
          </text>
        </g>
        <g className="od-chart-spot">
          <line x1={plot.x(spot)} x2={plot.x(spot)} y1={O.y0} y2={O.y1} />
        </g>

        <path d={plot.holdLine} className="od-outcome-hold" />
        <path d={plot.writtenLine} className="od-chart-line" />

        <g className="od-outcome-cursor" data-uid={uid}>
          <line x1={cx} x2={cx} y1={O.y0} y2={O.y1} />
          <circle cx={cx} cy={plot.y(holding)} r="4.5" className="hold" />
          <circle cx={cx} cy={plot.y(withCall)} r="5.5" />
        </g>

        <g className="od-chart-ticks">
          <text x={O.x0} y={O.axisY} textAnchor="start">
            {usd(plot.lo, 0)}
          </text>
          <text
            x={plot.x(spot)}
            y={O.axisY}
            textAnchor="middle"
            className="mark"
          >
            Mark {usd(spot, 0)}
          </text>
          <text x={O.x1} y={O.axisY} textAnchor="end">
            {usd(plot.hi, 0)}
          </text>
        </g>
      </svg>

      <ul className="od-outcome-legend">
        <li>
          <i className="line" />
          If you sell this call
        </li>
        <li>
          <i className="dash" />
          If you do nothing
        </li>
        <li>
          <i className="cushion" />
          Premium you pocket
        </li>
        <li>
          <i className="given" />
          Gains you give up above the strike
        </li>
      </ul>
    </div>
  );
}
