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
import type { VaultController } from '@/hooks/oddlot/use-vault';
import { selectableExpiries } from '@/lib/oddlot/market';
import { days, orderGreeks } from '@/lib/oddlot/math';
import type { OrderTerms, Quote } from '@/lib/oddlot/types';
import { parseOrderTerms } from '@/lib/oddlot/validation';
import type { ResolvedAsset } from '@/lib/preipo/types';
import { EXERCISE_WINDOW_DAYS } from '@/lib/preipo/terms';
import { AssetLogo } from './AssetLogo';
import { QuoteReview } from './QuoteReview';
import {
  Badge,
  Button,
  Empty,
  Field,
  Line,
  Money,
  Panel,
  PanelHead,
  compact,
  expiryLabel,
  qty,
  usd,
} from './shared';
import type { Transfer } from './TransferDialog';

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
  desk,
  feed,
  tab,
  openTrade,
  openUnderwrite,
  openPortfolio,
  onTransfer,
  pick,
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: PreIpoTab;
  openTrade: () => void;
  /** Take the reader to the ticket for whatever they just picked. */
  openUnderwrite: () => void;
  /** Where a written contract can be seen with the rest of the book. */
  openPortfolio: () => void;
  onTransfer: (transfer: Transfer) => void;
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
    /* Keyed on the company: a new token is a new ticket, with its own
       default strike and a fresh quote. */
    <Underwrite
      key={selected}
      data={data}
      feed={feed}
      current={current}
      onSelect={setSelected}
      openTrade={openTrade}
      openPortfolio={openPortfolio}
      desk={desk}
      onTransfer={onTransfer}
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

/** A round strike a little above the mark, on a grid the mark suggests. */
function defaultStrike(price: number) {
  const step = price >= 500 ? 25 : price >= 100 ? 5 : price >= 20 ? 1 : 0.5;
  return Math.ceil((price * 1.1) / step) * step;
}

/**
 * The covered-call ticket, written through the vault.
 *
 * Until now this screen priced a contract in the browser and ended at
 * a disabled "connect wallet" button: the vault's engine had learned
 * every sponsor token, but this ticket never asked it for anything.
 * It now runs the same road as every other product — the server
 * quotes the premium against the session mark, reserves the tokens,
 * and settles the contract at expiry on the token's committed close —
 * so a written call shows up in the portfolio with the rest of the
 * book. The mint policy still gates it: a token whose issuer can reach
 * into an escrow is not written on, and the reasons are listed here.
 *
 * The premium is the engine's, not the seller's ask. The old ticket
 * let the reader type a premium, which is an offer no one had funded;
 * the vault's counterparty pays the model price, as it does for a
 * covered call on NVDA.
 */
function Underwrite({
  data,
  feed,
  current,
  onSelect,
  openTrade,
  openPortfolio,
  desk,
  onTransfer,
}: {
  data: AssetsPayload;
  feed: MarkFeed;
  current: ResolvedAsset | null;
  onSelect: (id: string) => void;
  openTrade: () => void;
  openPortfolio: () => void;
  desk: VaultController;
  onTransfer: (transfer: Transfer) => void;
}) {
  const state = desk.state!;
  const session = state.book.date;
  const symbol = current?.asset.symbol ?? '';
  const under = state.market.underlyings.find((u) => u.symbol === symbol);
  const live = current ? feed.marks[symbol]?.price : undefined;

  // Daily sessions only: a covered call written for a week is not
  // written for an hourly test tick.
  const future = selectableExpiries(session).filter((d) => !d.includes('T'));
  const defaultExpiry =
    future.find((d) => days(session, d) >= EXERCISE_WINDOW_DAYS) ||
    future[0] ||
    '';

  const [amount, setAmount] = useState('0.25');
  const [strikeInput, setStrikeInput] = useState(() =>
    under ? String(defaultStrike(under.price)) : '',
  );
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [written, setWritten] = useState('');
  // A quote answers the draft it was asked for; a draft that has moved
  // on since discards the answer rather than reviewing it.
  const revision = useRef(0);

  const tokens = Number(amount) || 0;
  const strike = Number(strikeInput) || 0;

  const { terms, termsError } = useMemo(() => {
    if (!current || !under) return { terms: null, termsError: '' };
    try {
      const draft: OrderTerms = {
        symbol,
        name: `${company(current.asset.displayName)} covered call`,
        quantity: tokens,
        expiry,
        settlement: 'physical',
        reference: 'stock',
        legs: [{ kind: 'call', side: 'sell', strike, ratio: 1 }],
      };
      return { terms: parseOrderTerms(draft, session), termsError: '' };
    } catch (e) {
      return { terms: null, termsError: (e as Error).message };
    }
  }, [current, under, symbol, tokens, strike, expiry, session]);

  // What the desk would pay for it, so the picture moves as the reader
  // types; the funded quote replaces it the moment one exists.
  const modelPremium =
    terms && under
      ? Math.abs(
          orderGreeks(terms, under.price, session, under.volatility).price,
        )
      : 0;
  const premium = quote ? Math.abs(quote.premium) : modelPremium;

  const held = state.book.vault[symbol] ?? 0;
  const free = state.risk.freeShares[symbol] ?? 0;
  const inWallet = state.book.wallet[symbol] ?? 0;
  const short = terms ? Math.max(0, terms.quantity - free) : 0;

  const update = (set: (v: string) => void) => (v: string) => {
    revision.current++;
    set(v);
    setQuote(null);
    setError('');
    setWritten('');
  };

  const request = async () => {
    if (!terms) return;
    const at = revision.current;
    setRequesting(true);
    setError('');
    try {
      const result = await desk.quote(terms);
      if (revision.current === at) setQuote(result);
    } catch (e) {
      if (revision.current === at) setError((e as Error).message);
    } finally {
      setRequesting(false);
    }
  };

  const execute = async () => {
    if (!quote || !terms) return;
    if (await desk.act({ type: 'execute', quoteId: quote.id })) {
      setQuote(null);
      setWritten(
        `${qty(terms.quantity)} ${symbol} reserved until ${expiryLabel(terms.expiry)}, and ${usd(Math.abs(quote.premium))} paid into the vault.`,
      );
    }
  };

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
  const writable = current.verdict.escrowSupported && !!under;
  const exerciseTotal = terms ? terms.quantity * strike : 0;

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
          ) : !under ? (
            <p className="od-note">
              This token has no replay path on the desk yet, so nothing can be
              written against it.
            </p>
          ) : (
            <>
              <Field
                label="Tokens to escrow"
                hint={`Session mark ${usd(under.price)}${live != null ? ` · live ${usd(live)}` : ''}`}
                help={`${qty(free)} ${symbol} free in the vault of ${qty(held)} held; ${qty(inWallet)} in the wallet.`}
              >
                <input
                  aria-label="Tokens to escrow"
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => update(setAmount)(e.target.value)}
                />
              </Field>
              <Field
                label="Strike per token (USDC)"
                hint={
                  strike > 0
                    ? `${strike / under.price - 1 >= 0 ? '+' : ''}${((strike / under.price - 1) * 100).toFixed(1)}% vs the mark`
                    : undefined
                }
              >
                <input
                  aria-label="Strike per token"
                  value={strikeInput}
                  inputMode="decimal"
                  onChange={(e) => update(setStrikeInput)(e.target.value)}
                />
              </Field>
              <Field label="Expiry">
                <select
                  aria-label="Covered call expiry"
                  value={expiry}
                  onChange={(e) => update(setExpiry)(e.target.value)}
                >
                  {future.map((d) => (
                    <option key={d} value={d}>
                      {expiryLabel(d)} · {Math.round(days(session, d))}d
                    </option>
                  ))}
                </select>
              </Field>

              <div className="od-lines">
                <Line
                  label={quote ? 'Premium, funded' : 'Premium, model'}
                  value={terms ? usd(premium) : '—'}
                  tone="up"
                />
                <Line
                  label="Exercise payment if called"
                  value={terms ? usd(exerciseTotal) : '—'}
                />
              </div>

              {short > 0 && (
                <div className="od-note od-deposit-cue">
                  <p>
                    Writing {qty(terms!.quantity)} {symbol} needs {qty(short)}{' '}
                    more in the vault.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onTransfer({ asset: symbol, direction: 'deposit' })
                    }
                  >
                    Deposit {symbol}
                  </Button>
                </div>
              )}

              {(termsError || error) && (
                <p className="od-error" role="alert">
                  {termsError || error}
                </p>
              )}
              {written && (
                <output className="od-note od-written">
                  <ShieldCheck size={13} /> Written. {written}{' '}
                  <button className="od-link" onClick={openPortfolio}>
                    See it in the portfolio
                  </button>
                </output>
              )}
              <Button
                size="lg"
                full
                disabled={!terms || requesting || desk.busy || short > 0}
                onClick={request}
              >
                {requesting ? 'Pricing…' : 'Review covered call'}
              </Button>
              <p className="od-note">
                Settles in your {state.mode} vault on the session clock. No
                sponsor token moves on chain.
              </p>
              {/* What the issuer can still do to this mint, on the
                  ticket rather than three screens away. */}
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
              terms && writable
                ? `Two outcomes, both fixed the moment you sign.`
                : 'Set the terms to price both outcomes.'
            }
          />
          {terms && under && writable ? (
            <>
              <div className="od-panel-body od-outcomes">
                <div className="od-outcome">
                  <span>Above {usd(strike, 0)}</span>
                  <strong>
                    <Money value={premium + exerciseTotal} />
                  </strong>
                  <small>
                    The buyer exercises. You deliver {qty(terms.quantity)}{' '}
                    {symbol} and keep both the premium and the exercise payment.
                  </small>
                </div>
                <div className="od-outcome">
                  <span>At or below {usd(strike, 0)}</span>
                  <strong className="up">
                    <Money value={premium} />
                  </strong>
                  <small>
                    It expires. You keep the premium and all{' '}
                    {qty(terms.quantity)} {symbol}.
                  </small>
                </div>
              </div>

              <div className="od-panel-body">
                <OutcomeChart
                  tokens={terms.quantity}
                  strike={strike}
                  premium={premium}
                  spot={under.price}
                  symbol={symbol}
                />
              </div>
            </>
          ) : (
            <Empty
              title="Set the terms to price it"
              description="Enter a token quantity, a strike and an expiry to see both outcomes."
            />
          )}

          {current.onchain && (
            <div className="od-panel-foot">
              <span>Mint verified on {data.network}</span>
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
      </div>

      {quote && (
        <QuoteReview
          quote={quote}
          revision={state.revision}
          busy={desk.busy}
          onClose={() => setQuote(null)}
          onConfirm={() => void execute()}
        />
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
