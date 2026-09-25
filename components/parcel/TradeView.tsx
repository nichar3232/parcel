'use client';
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LockKeyhole, Minus, Plus } from 'lucide-react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { MarketUnderlying, OrderTerms, Quote } from '@/lib/parcel/types';
import { deliveryBounds } from '@/lib/parcel/envelope';
import { bounded, DEFAULT_BLACK_SCHOLES, orderGreeks } from '@/lib/parcel/math';
import { parseOrderTerms } from '@/lib/parcel/validation';
import {
  CATEGORIES,
  CONTRACTS,
  templateTerms,
  templatesIn,
  type Category,
  strikeStep,
} from '@/lib/parcel/templates';
import { offeredExpiries } from '@/lib/parcel/market';
import { quoteAround, spreadCost } from '@/lib/parcel/spread';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { CurveEditor } from './CurveEditor';
import { OptionsChain } from './OptionsChain';
import { ExpiryPicker } from './ExpiryPicker';
import { PayoffChart } from './PayoffChart';
import { QuoteReview } from './QuoteReview';
import { ContractLegEditor } from './ContractLegEditor';
import { Surface3D } from './Surface3D';
import {
  Badge,
  Button,
  Empty,
  Field,
  Line,
  Panel,
  PanelHead,
  Segmented,
  Stat,
  expiryLabel,
  markOf,
  qty,
  usd,
} from './shared';

export type TradeTab = 'trade' | 'underwrite' | 'structures';

const EMPTY_UNDERLYINGS: MarketUnderlying[] = [];

export function TradeView({
  desk,
  feed,
  tab,
  choice,
  symbol,
  onSymbol,
  symbols,
  advanced,
  onAdvanced,
}: {
  desk: VaultController;
  feed?: MarkFeed;
  tab: TradeTab;
  /** The contract, or on Structures the family, chosen in the rail. */
  choice: string;
  /** The underlying the ticket is written on. */
  symbol: string;
  onSymbol: (symbol: string) => void;
  /** Restrict the underlying picker, as the Pre-IPO page does. */
  symbols?: string[];
  advanced: boolean;
  onAdvanced: (on: boolean) => void;
}) {
  const state = desk.state!;
  // An idempotent response from an older deploy can briefly carry no
  // catalog. Price from the session snapshot while the next refresh fills
  // it rather than dereferencing a missing first instrument.
  const underlyings = state.market.underlyings ?? EMPTY_UNDERLYINGS;
  const under = underlyings.find((u) => u.symbol === symbol) ?? underlyings[0];
  // The live mark when the feed has one, so every figure built on spot
  // moves with the market; the snapshot's price until it does.
  const price =
    markOf(state, feed, symbol)?.price ?? under?.price ?? state.market.price;
  const referenceMark = markOf(state, feed, symbol);
  // Hoisted: a memo keyed on `state.book.date` cannot be preserved
  // through the compiler, because it cannot prove the chain is stable.
  const session = state.book.date;
  const future = offeredExpiries(state.market, session);
  // A fortnight out: long enough that the premium is not all decay.
  const fortnight = new Date(Date.parse(session) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const defaultExpiry =
    future.find((d) => d >= fortnight) || future[0] || session;

  /**
   * What the rail opened this screen on.
   *
   * On Options the choice is the contract itself; on Structures it is
   * the family, and the screen opens on that family's first template.
   */
  const category = (
    CATEGORIES.includes(choice as Category) ? choice : 'Direction'
  ) as Category;
  const opening =
    tab === 'structures'
      ? (templatesIn(category)[0]?.id ?? 'call-spread')
      : CONTRACTS.includes(choice)
        ? choice
        : tab === 'underwrite'
          ? 'covered-call'
          : 'call';

  const [selected, setSelected] = useState(opening);
  const [draft, setDraft] = useState<OrderTerms>(() =>
    templateTerms(opening, defaultExpiry, symbol, price),
  );
  /**
   * What the left column shows.
   *
   * Options opens on the ladder, because the first question is which
   * strike; the payoff is there for whoever wants to see what the one
   * they picked turns into. Structures and Underwrite have no ladder,
   * so they are always the picture.
   */
  // Entering Options opens the ladder on the plain long call. Selecting a
  // named contract from the navigation is a more specific intention, so it
  // opens its ticket and payoff instead of asking the reader to choose it
  // again from the chain.
  const [browse, setBrowse] = useState(tab === 'trade' && choice === 'call');
  /** Which ladder the chain shows, steered from the screen's top line. */
  const [chainSide, setChainSide] = useState<'buy' | 'sell'>('buy');
  const [chainKind, setChainKind] = useState<'call' | 'put'>('call');
  const [chainExpiry, setChainExpiry] = useState(
    () => future.find((d) => !d.includes('T')) || future[0] || '',
  );
  const chainDate = future.includes(chainExpiry)
    ? chainExpiry
    : future[0] || '';

  const [quote, setQuote] = useState<Quote | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [shock, setShock] = useState(0);
  const revision = useRef(0);

  /**
   * The draft, with an expiry that is certainly in the future.
   *
   * Left unmemoised deliberately. Hand-written memos here could not be
   * preserved through the React Compiler — it cannot prove the session
   * date is stable — so the compiler stopped optimising the component
   * entirely. Dropping them lets it memoise the whole render itself,
   * which is what it is for.
   */
  const effective: OrderTerms = {
    ...draft,
    expiry:
      draft.reference === 'dividend'
        ? '2025-03-12'
        : draft.expiry > session
          ? draft.expiry
          : defaultExpiry,
  };

  let validationError = '';
  try {
    parseOrderTerms(effective, session);
  } catch (e) {
    validationError = (e as Error).message;
  }
  const invalid = !!validationError;

  const reference =
    effective.reference === 'dividend' ? state.market.dividend : price;
  const vol =
    effective.reference === 'dividend'
      ? 0.8
      : (under?.volatility ?? state.market.volatility);

  const g = invalid
    ? { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 }
    : orderGreeks(effective, reference, session, vol);

  // The market for exactly this contract: a buyer pays the ask, a writer
  // receives the bid. Zero-width off the live market.
  const crossing = invalid ? 0 : spreadCost(effective, reference, session, vol);
  const market = quoteAround(g.price, crossing);
  const trades = g.price + crossing;
  const referenceBasis = !referenceMark
    ? 'Snapshot reference'
    : referenceMark.stale
      ? `Stale ${referenceMark.source} mark`
      : referenceMark.source === 'massive-nbbo'
        ? 'Fresh consolidated NBBO midpoint'
        : referenceMark.source === 'coinbase'
          ? 'Fresh Coinbase venue midpoint'
          : referenceMark.source === 'pyth'
            ? 'Fresh Pyth oracle mark'
            : referenceMark.source === 'prestocks'
              ? 'PreStocks publisher mark'
              : referenceMark.source === 'yahoo'
                ? 'Delayed Yahoo reference'
                : 'Simulated reference mark';

  const includedStock =
    !invalid &&
    ['covered-call', 'put', 'collar'].includes(selected) &&
    effective.reference === 'stock'
      ? effective.quantity
      : 0;
  const cashBound = !invalid ? deliveryBounds([effective]).cashMin : 0n;

  /**
   * The worst and best the position can do, sampled over the same
   * window the chart draws. Quoted rather than derived from the legs so
   * a curve contract and a four-leg structure answer the same way.
   */

  const select = (id: string) => {
    revision.current++;
    setSelected(id);
    setDraft(templateTerms(id, defaultExpiry, symbol, price));
    setError('');
    setQuote(null);
  };

  const update = (patch: Partial<OrderTerms>) => {
    revision.current++;
    setDraft((d) => ({ ...d, ...patch }));
    setQuote(null);
    setError('');
  };

  const request = async () => {
    const at = revision.current;
    setRequesting(true);
    setError('');
    try {
      const result = await desk.quote(effective);
      if (revision.current === at) setQuote(result);
    } catch (e) {
      if (revision.current === at) setError((e as Error).message);
    } finally {
      setRequesting(false);
    }
  };

  const execute = async () => {
    if (quote && (await desk.act({ type: 'execute', quoteId: quote.id })))
      setQuote(null);
  };

  // "Trade" and "Underwrite" were two tabs running the same ticket with
  // the side flipped, so they are one tab and the side is a choice on
  // it.

  const single = effective.legs.length === 1 && !effective.curve;

  return (
    <>
      {/* Five things used to be stacked on this page: a pair of intent
          cards, the ticket, the payoff, a table of open contracts and
          two footnotes pointing elsewhere. It is the ticket and the
          payoff now. The intent cards asked the question the ticket's
          own buy/sell control asks, open contracts live on Portfolio →
          Holdings with every other position, and a footnote is not a
          component. */}
      {tab === 'structures' && (
        <>
          <div className="od-templates">
            {templatesIn(category)
              // Dividend contracts settle on the stored 2025 event, which
              // the live market has no counterpart for.
              .filter(
                (t) =>
                  state.market.clock !== 'live' || t.reference !== 'dividend',
              )
              .map((t) => (
                <button
                  key={t.id}
                  className={`od-template ${selected === t.id ? 'selected' : ''}`}
                  aria-pressed={selected === t.id}
                  onClick={() => select(t.id)}
                >
                  <span>{t.tag}</span>
                  <h3>{t.name}</h3>
                  <p>{t.description}</p>
                </button>
              ))}
          </div>
        </>
      )}

      {/* Everything that steers this screen, on one line above it: the
          ladder's side, kind and expiry on the left, the view and the
          detail level on the right. */}
      <div className="od-row-end">
        {browse && tab === 'trade' && (
          <div className="od-chain-controls">
            <Segmented
              label="Side"
              value={chainSide}
              onChange={(v) => setChainSide(v as 'buy' | 'sell')}
              options={[
                { id: 'buy', label: 'Buy' },
                { id: 'sell', label: 'Write' },
              ]}
            />
            <Segmented
              label="Contract kind"
              value={chainKind}
              onChange={(v) => setChainKind(v as 'call' | 'put')}
              options={[
                { id: 'call', label: 'Call' },
                { id: 'put', label: 'Put' },
              ]}
            />
            <ExpiryPicker
              dates={future}
              value={chainDate}
              asOf={state.book.date}
              onChange={setChainExpiry}
            />
          </div>
        )}
        {tab === 'trade' && (
          <Segmented
            label="Builder source"
            value={browse ? 'chain' : 'builder'}
            onChange={(v) => {
              revision.current++;
              setQuote(null);
              setBrowse(v === 'chain');
            }}
            options={[
              { id: 'chain', label: 'Chain' },
              { id: 'builder', label: 'Payoff' },
            ]}
          />
        )}
      </div>

      <div className="od-work">
        {browse && tab === 'trade' ? (
          <OptionsChain
            desk={desk}
            feed={feed}
            symbol={symbol}
            quantity={effective.quantity}
            side={chainSide}
            kind={chainKind}
            expiry={chainDate}
            onSelect={(terms) => {
              revision.current++;
              setSelected(
                terms.legs[0].side === 'sell'
                  ? terms.legs[0].kind === 'call'
                    ? 'covered-call'
                    : 'secured-put'
                  : terms.legs[0].kind,
              );
              // The ladder chooses a strike and a side, not a size:
              // the ticket's quantity is what the ladder was priced
              // at, so it carries straight through.
              setDraft({ ...terms, quantity: effective.quantity });
              setQuote(null);
              setError('');
              // Selecting a model indication opens a single, editable payoff
              // simulation. The ladder is available again by an explicit
              // action, instead of leaving a second pricing surface in view.
              setBrowse(false);
            }}
          />
        ) : (
          // What it pays, for whoever wants to see it.
          <div className="od-insight">
            {tab === 'trade' && (
              <div className="od-simulation-cue">
                <div>
                  <span>Position simulation</span>
                  <b>
                    {effective.legs.length === 1
                      ? `${effective.legs[0].side === 'buy' ? 'Long' : 'Short'} ${effective.legs[0].kind} · ${usd(effective.legs[0].strike, effective.legs[0].strike % 1 === 0 ? 0 : 2)} strike`
                      : effective.name}
                  </b>
                </div>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setBrowse(true)}
                >
                  <ArrowLeft size={14} />
                  Back to chain
                </Button>
              </div>
            )}
            <Panel>
              {!invalid ? (
                <PayoffChart
                  terms={effective}
                  stockQuantity={includedStock}
                  premium={g.price}
                  spot={reference}
                  shock={shock}
                  onShock={setShock}
                  date={session}
                  vol={vol}
                />
              ) : (
                <Empty
                  title="Choose valid terms"
                  description={validationError}
                />
              )}
              {/* Delta, theta, vega and gamma are the vocabulary of
                  someone who already knows what they are looking at.
                  Under the chart in Basic they are five more numbers
                  between the reader and the one decision on the page,
                  so the whole row, and the pricing basis under it,
                  belong to Advanced. */}
              {advanced && (
                <>
                  <div className="od-greeks">
                    <Stat
                      label="Per +1¢ move"
                      value={usd((g.delta + includedStock) * 0.01, 4)}
                      detail="Local estimate"
                    />
                    <Stat
                      label={includedStock ? 'Net delta' : 'Delta'}
                      value={(g.delta + includedStock).toFixed(3)}
                      detail="Shares of exposure"
                    />
                    <Stat
                      label="Theta per day"
                      value={usd(g.theta, 4)}
                      detail="Position-level decay"
                    />
                    <Stat
                      label="Vega per vol point"
                      value={usd(g.vega, 4)}
                      detail="Modelled vol sensitivity"
                    />
                    <Stat
                      label="Gamma"
                      value={g.gamma.toFixed(4)}
                      detail="Delta change per $1"
                    />
                  </div>
                  <div className="od-panel-foot">
                    <span>Pricing basis</span>
                    <span>
                      {effective.reference === 'dividend'
                        ? 'Committed dividend event'
                        : state.market.clock === 'live'
                          ? referenceBasis
                          : session.includes('T')
                            ? 'Daily close carried forward'
                            : 'Stored historical close'}
                      {' — Black-Scholes at '}
                      {(vol * 100).toFixed(0)}% vol, reference{' '}
                      {usd(
                        reference,
                        effective.reference === 'dividend' ? 4 : 2,
                      )}
                      {effective.reference === 'stock' && (
                        <>
                          {', '}
                          {(DEFAULT_BLACK_SCHOLES.riskFreeRate * 100).toFixed(
                            2,
                          )}
                          %{' rate, '}
                          {(DEFAULT_BLACK_SCHOLES.dividendYield * 100).toFixed(
                            2,
                          )}
                          %{' yield'}
                        </>
                      )}
                    </span>
                  </div>
                </>
              )}
            </Panel>

            {advanced && !invalid && (
              <Panel>
                <PanelHead
                  title="Value across price and time"
                  description="What the position marks at, every day between now and expiry."
                  action={<Badge tone="accent">Surface</Badge>}
                />
                <Surface3D
                  terms={effective}
                  premium={g.price}
                  spot={reference}
                  date={session}
                  vol={vol}
                  stockQuantity={includedStock}
                />
              </Panel>
            )}
          </div>
        )}

        {/* ---------------- what to write it on ---------------- */}
        <Panel className="od-ticket">
          <PanelHead
            title={tab === 'structures' ? 'Build a structure' : 'Your contract'}
            action={
              <button
                type="button"
                className={`od-switch ${advanced ? 'on' : ''}`}
                aria-pressed={advanced}
                onClick={() => onAdvanced(!advanced)}
              >
                <i aria-hidden />
                Advanced
              </button>
            }
          />
          <div className="od-panel-body">
            <Field label="Underlying">
              <select
                aria-label="Underlying"
                value={symbol}
                onChange={(e) => onSymbol(e.target.value)}
              >
                {underlyings
                  .filter((u) => !symbols || symbols.includes(u.symbol))
                  .map((u) => (
                    <option key={u.symbol} value={u.symbol}>
                      {u.name} ({u.symbol}){'  '}
                      {usd(markOf(state, feed, u.symbol)?.price ?? u.price)}
                      {u.simulated && state.market.clock !== 'live'
                        ? ', simulated path'
                        : ''}
                    </option>
                  ))}
              </select>
            </Field>

            <SizeField
              quantity={draft.quantity}
              unitPremium={invalid ? 0 : Math.abs(trades) / effective.quantity}
              onChange={(quantity) => update({ quantity })}
            />

            {/* strike, in Basic, for the contracts that have exactly one */}
            {!advanced && single && effective.reference === 'stock' && (
              <div className="od-control">
                <div className="od-control-top">
                  <label htmlFor="od-strike">Strike</label>
                  <span>
                    {usd(effective.legs[0].strike, 0)}
                    {', '}
                    {((effective.legs[0].strike / price - 1) * 100).toFixed(1)}%
                    from spot
                  </span>
                </div>
                <input
                  id="od-strike"
                  aria-label="Strike price"
                  type="range"
                  min={
                    Math.round((price * 0.7) / strikeStep(price)) *
                    strikeStep(price)
                  }
                  max={
                    Math.round((price * 1.3) / strikeStep(price)) *
                    strikeStep(price)
                  }
                  step={strikeStep(price)}
                  value={effective.legs[0].strike}
                  onChange={(e) =>
                    update({
                      legs: [
                        {
                          ...effective.legs[0],
                          strike: Number(e.target.value),
                        },
                      ],
                    })
                  }
                />
              </div>
            )}

            <Field label="Expiry">
              <select
                aria-label="Expiration"
                value={effective.expiry}
                onChange={(e) => update({ expiry: e.target.value })}
                disabled={effective.reference === 'dividend'}
              >
                {(effective.reference === 'dividend'
                  ? ['2025-03-12']
                  : future
                ).map((d) => (
                  <option key={d} value={d}>
                    {expiryLabel(d)}
                  </option>
                ))}
              </select>
            </Field>

            {advanced &&
              (draft.curve ? (
                <CurveEditor draft={draft} update={update} />
              ) : (
                <ContractLegEditor draft={draft} update={update} mode={tab} />
              ))}

            <div className="od-lines">
              {!invalid && crossing > 0 && (
                <div className="od-bidask">
                  <span>
                    Model bid{' '}
                    <b>
                      {usd(Math.abs(g.price < 0 ? market.ask : market.bid))}
                    </b>
                  </span>
                  <span>
                    Mid <b>{usd(Math.abs(g.price))}</b>
                  </span>
                  <span>
                    Model ask{' '}
                    <b>
                      {usd(Math.abs(g.price < 0 ? market.bid : market.ask))}
                    </b>
                  </span>
                </div>
              )}
              <Line
                label={trades < 0 ? 'You receive' : 'You pay'}
                value={invalid ? '—' : usd(Math.abs(trades))}
              />
              {!invalid && cashBound < 0n && (
                <Line
                  label="Reserved until expiry"
                  value={usd(Number(-cashBound) / 1e6)}
                  tone="muted"
                />
              )}
            </div>

            {error && (
              <p className="od-error" role="alert">
                {error}
              </p>
            )}
            {invalid && (
              <p className="od-error" role="alert">
                {validationError}
              </p>
            )}
            {!bounded(draft.legs) && draft.settlement === 'cash' && (
              <p className="od-note">
                This payoff has an uncapped upside leg. Choose physical
                settlement or add a cap.
              </p>
            )}

            <Button
              size="lg"
              full
              onClick={() => void request()}
              disabled={invalid || requesting || desk.busy}
            >
              {requesting ? 'Checking collateral…' : 'Review funded quote'}
              <ArrowRight size={16} />
            </Button>
            <p className="od-note">
              <LockKeyhole size={12} />
              Nothing is signed until you review the quote.
            </p>
          </div>
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
    </>
  );
}

/**
 * How much, in shares or in dollars.
 *
 * Five preset chips in a box beside the input read as a toolbar someone
 * had generated; the budget and sensitivity sizing lived in a separate
 * disclosure further down. One field now: type a number, or step it,
 * and say whether the number is shares or dollars of premium. Dollars
 * are converted at the current model premium, so the size tracks the
 * market as it moves.
 */
function SizeField({
  quantity,
  unitPremium,
  onChange,
}: {
  quantity: number;
  /** Premium per share-equivalent, for sizing in dollars. */
  unitPremium: number;
  onChange: (quantity: number) => void;
}) {
  const [unit, setUnit] = useState<'shares' | 'usd'>('shares');
  const [dollars, setDollars] = useState('');
  const canPrice = unitPremium > 0.000001;
  const inDollars = unit === 'usd' && canPrice;
  const round = (n: number) => Math.max(0.000001, Math.round(n * 1e6) / 1e6);
  const step = (dir: 1 | -1) => {
    if (inDollars) {
      const now = Number(dollars) || quantity * unitPremium;
      const next = Math.max(1, Math.round(now) + dir * (now < 20 ? 1 : 10));
      setDollars(String(next));
      onChange(round(next / unitPremium));
      return;
    }
    const q = Number.isNaN(quantity) ? 1 : quantity;
    const by = q < 1 || (dir < 0 && q <= 1) ? 0.25 : 1;
    onChange(round(Math.max(by, (Math.round(q / by) + dir) * by)));
  };
  const shown = inDollars
    ? dollars || (quantity * unitPremium).toFixed(2)
    : Number.isNaN(quantity)
      ? ''
      : quantity;
  return (
    <div className="od-control">
      <div className="od-control-top">
        <label htmlFor="od-size">Size</label>
        <fieldset className="od-unit" aria-label="Size unit">
          <button
            type="button"
            className={!inDollars ? 'on' : ''}
            aria-pressed={!inDollars}
            onClick={() => setUnit('shares')}
          >
            Shares
          </button>
          <button
            type="button"
            className={inDollars ? 'on' : ''}
            aria-pressed={inDollars}
            disabled={!canPrice}
            onClick={() => {
              setDollars((quantity * unitPremium).toFixed(2));
              setUnit('usd');
            }}
          >
            USD
          </button>
        </fieldset>
      </div>
      <div className="od-stepper">
        <button
          type="button"
          aria-label="Decrease size"
          onClick={() => step(-1)}
        >
          <Minus size={14} />
        </button>
        <input
          id="od-size"
          aria-label={inDollars ? 'Premium budget in USD' : 'Contract quantity'}
          type="number"
          min="0.000001"
          max={inDollars ? undefined : 1000}
          step="any"
          value={shown}
          onChange={(e) => {
            const v = e.target.value;
            if (inDollars) {
              setDollars(v);
              if (Number(v) > 0) onChange(round(Number(v) / unitPremium));
            } else onChange(v === '' ? NaN : Number(v));
          }}
        />
        <span>{inDollars ? 'USD' : 'shares'}</span>
        <button
          type="button"
          aria-label="Increase size"
          onClick={() => step(1)}
        >
          <Plus size={14} />
        </button>
      </div>
      {inDollars && (
        <small>
          {qty(quantity)} share-equivalents at {usd(unitPremium)} each
        </small>
      )}
    </div>
  );
}
