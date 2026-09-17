'use client';
import { useRef, useState } from 'react';
import {
  ArrowRight,
  LockKeyhole,
  Rocket,
  Shield,
  Table2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import type { OrderTerms, Quote } from '@/lib/oddlot/types';
import { deliveryBounds } from '@/lib/oddlot/envelope';
import { bounded, orderGreeks, strategyPnl } from '@/lib/oddlot/math';
import { parseOrderTerms } from '@/lib/oddlot/validation';
import { templates, templateTerms } from '@/lib/oddlot/templates';
import { selectableExpiries } from '@/lib/oddlot/market';
import { CurveEditor } from './CurveEditor';
import { SizingControl } from './SizingControl';
import { OptionsChain } from './OptionsChain';
import { PayoffChart } from './PayoffChart';
import { QuoteReview } from './QuoteReview';
import { ContractLegEditor } from './ContractLegEditor';
import { Surface3D } from './Surface3D';
import { Scoreboard } from './Scoreboard';
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
  qty,
  usd,
} from './shared';

export type TradeTab = 'trade' | 'underwrite' | 'structures';

/**
 * The two decisions Basic mode is allowed to ask.
 *
 * The trade screen used to open on a leg editor, a ratio dropdown, a
 * settlement selector and a sizing calculator, which is a lot of
 * machinery to put in front of someone whose actual question is "do I
 * think it goes up". Basic asks that question with two cards and then
 * gets out of the way; everything else is one click into Advanced.
 */
const INTENTS: Record<
  TradeTab,
  { id: string; icon: typeof TrendingUp; title: string; body: string }[]
> = {
  trade: [
    {
      id: 'call',
      icon: TrendingUp,
      title: 'I think it goes up',
      body: 'Buy the right to buy at a fixed price. The premium is the most you can lose.',
    },
    {
      id: 'put',
      icon: TrendingDown,
      title: 'I want downside cover',
      body: 'Buy the right to sell at a fixed price. It puts a floor under a share you hold.',
    },
  ],
  underwrite: [
    {
      id: 'covered-call',
      icon: Shield,
      title: 'Earn on shares I own',
      body: 'Sell a call against your stock. You keep the premium; the upside is capped at the strike.',
    },
    {
      id: 'secured-put',
      icon: Wallet,
      title: 'Earn on cash I hold',
      body: 'Sell a put against reserved cash. You keep the premium, and may end up buying the share.',
    },
  ],
  structures: [],
};

const CATEGORIES = [
  'Direction',
  'Volatility',
  'Convexity',
  'Dividends',
  'Cash flow',
] as const;

const SIZES = [0.25, 0.5, 1, 2, 5];

export function TradeView({
  desk,
  feed,
  tab,
  advanced,
  openPreIpo,
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: TradeTab;
  advanced: boolean;
  openPreIpo: () => void;
}) {
  const state = desk.state!;
  // Hoisted: a memo keyed on `state.book.date` cannot be preserved
  // through the compiler, because it cannot prove the chain is stable.
  const session = state.book.date;
  const future = selectableExpiries(session);
  const defaultExpiry =
    future.find((d) => d >= '2025-02-07') || future[0] || session;

  const [selected, setSelected] = useState(
    tab === 'underwrite'
      ? 'covered-call'
      : tab === 'structures'
        ? 'call-spread'
        : 'call',
  );
  const [draft, setDraft] = useState<OrderTerms>(() =>
    templateTerms(
      tab === 'underwrite'
        ? 'covered-call'
        : tab === 'structures'
          ? 'call-spread'
          : 'call',
      defaultExpiry,
    ),
  );
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(
    'Direction',
  );
  const [browse, setBrowse] = useState(false);
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
    effective.reference === 'dividend' ? state.market.dividend : state.market.price;
  const vol = effective.reference === 'dividend' ? 0.8 : state.market.volatility;

  const g = invalid
    ? { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 }
    : orderGreeks(effective, reference, session, vol);

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
  const outcome = (() => {
    if (invalid)
      return { worst: 0, best: 0, breakEven: [] as number[], capped: true };
    const strikes = effective.curve
      ? [effective.curve.lower, effective.curve.upper]
      : effective.legs.map((l) => l.strike);
    const low = Math.min(...strikes),
      high = Math.max(...strikes);
    const lo = Math.min(reference * 0.5, low * 0.7);
    const hi = Math.max(reference * 1.6, high * 1.4);
    const rows = Array.from({ length: 201 }, (_, i) => {
      const price = lo + ((hi - lo) * i) / 200;
      return {
        price,
        pnl: strategyPnl(effective, price, reference, g.price, includedStock),
      };
    });
    const breakEven: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (a.pnl === 0 || (a.pnl < 0) === (b.pnl < 0)) continue;
      breakEven.push(a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl)));
    }
    const worst = Math.min(...rows.map((r) => r.pnl));
    const best = Math.max(...rows.map((r) => r.pnl));
    const span = best - worst || 1;
    /**
     * Whether each end of the payoff has actually stopped moving.
     *
     * Read off the drawn shape rather than from the legs. `bounded()`
     * answers whether the option legs net out, which is the question
     * cash settlement asks — and it called a covered call uncapped,
     * because the short call alone is. With the share included the
     * position plainly stops at the strike, and the scoreboard was
     * telling the writer their upside had no ceiling.
     */
    const flat = (a: number, b: number) => Math.abs(a - b) <= span * 0.004;
    return {
      worst,
      best,
      breakEven,
      capped: flat(rows.at(-1)!.pnl, rows.at(-6)!.pnl),
      // A position that is still losing at the bottom of the window has
      // no worst case to quote, only a worst case at a price.
      floored: flat(rows[0].pnl, rows[5].pnl),
      riskAt: lo,
    };
  })();

  const select = (id: string) => {
    revision.current++;
    setSelected(id);
    setDraft(templateTerms(id, defaultExpiry));
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

  const active = state.book.options.filter((p) => p.status === 'active');
  const choices = templates.filter((t) =>
    tab === 'trade'
      ? ['call', 'put'].includes(t.id)
      : tab === 'underwrite'
        ? ['covered-call', 'secured-put'].includes(t.id)
        : !['call', 'put', 'covered-call', 'secured-put'].includes(t.id),
  );

  const single = effective.legs.length === 1 && !effective.curve;
  const live = feed.marks.NVDA;

  return (
    <>
      {/* Basic opens on the question, not on the machinery. */}
      {!advanced && tab !== 'structures' && (
        <div className="od-intents">
          {INTENTS[tab].map((i) => {
            const Icon = i.icon;
            return (
              <button
                key={i.id}
                className={`od-intent ${selected === i.id ? 'selected' : ''}`}
                aria-pressed={selected === i.id}
                onClick={() => select(i.id)}
              >
                <Icon size={20} />
                <strong>{i.title}</strong>
                <p>{i.body}</p>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'structures' && (
        <>
          <Segmented
            label="Structure family"
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((c) => ({ id: c, label: c }))}
          />
          <div className="od-templates">
            {choices
              .filter((t) =>
                category === 'Dividends'
                  ? t.reference === 'dividend'
                  : category === 'Convexity'
                    ? !!t.curve
                    : category === 'Cash flow'
                      ? t.id === 'box'
                      : category === 'Volatility'
                        ? ['straddle', 'strangle', 'condor', 'butterfly'].includes(
                            t.id,
                          )
                        : ['call-spread', 'put-spread', 'collar'].includes(t.id),
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

      {advanced && tab === 'trade' && (
        <div className="od-row-end">
          <Segmented
            label="Builder source"
            size="sm"
            value={browse ? 'chain' : 'builder'}
            onChange={(v) => {
              revision.current++;
              setQuote(null);
              setBrowse(v === 'chain');
            }}
            options={[
              { id: 'builder', label: 'Ticket' },
              { id: 'chain', label: 'Options chain' },
            ]}
          />
        </div>
      )}

      {browse && advanced && tab === 'trade' && (
        <OptionsChain
          desk={desk}
          onSelect={(terms) => {
            revision.current++;
            setSelected(
              terms.legs[0].side === 'sell'
                ? terms.legs[0].kind === 'call'
                  ? 'covered-call'
                  : 'secured-put'
                : terms.legs[0].kind,
            );
            setDraft(terms);
            setQuote(null);
            setError('');
            setBrowse(false);
          }}
        />
      )}

      {(!browse || !advanced || tab !== 'trade') && (
        <div className="od-work">
          {/* ---------------- the ticket ---------------- */}
          <Panel className="od-ticket">
            <PanelHead
              title={
                tab === 'underwrite' ? 'Write an option' : 'Build your contract'
              }
              action={
                <Badge tone={live?.source === 'simulated' ? 'neutral' : 'green'}>
                  NVDA {usd(state.market.price)}
                </Badge>
              }
            />
            <div className="od-panel-body">
              {advanced && tab !== 'structures' && (
                <Segmented
                  label="Contract"
                  value={selected}
                  onChange={select}
                  options={choices.map((t) => ({ id: t.id, label: t.name }))}
                />
              )}

              {/* size */}
              <div className="od-control">
                <div className="od-control-top">
                  <label htmlFor="od-size">Size</label>
                  <span>share-equivalents</span>
                </div>
                <div className="od-size-row">
                  <input
                    id="od-size"
                    aria-label="Contract quantity"
                    type="number"
                    min="0.000001"
                    max="1000"
                    step="any"
                    value={Number.isNaN(draft.quantity) ? '' : draft.quantity}
                    onChange={(e) =>
                      update({
                        quantity:
                          e.target.value === '' ? NaN : Number(e.target.value),
                      })
                    }
                  />
                  <div className="od-chips">
                    {SIZES.map((n) => (
                      <button
                        key={n}
                        className={draft.quantity === n ? 'on' : ''}
                        onClick={() => update({ quantity: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* strike, in Basic, for the contracts that have exactly one */}
              {!advanced && single && effective.reference === 'stock' && (
                <div className="od-control">
                  <div className="od-control-top">
                    <label htmlFor="od-strike">Strike</label>
                    <span>
                      {usd(effective.legs[0].strike, 0)}
                      {', '}
                      {(
                        (effective.legs[0].strike / state.market.price - 1) *
                        100
                      ).toFixed(1)}
                      % from spot
                    </span>
                  </div>
                  <input
                    id="od-strike"
                    aria-label="Strike price"
                    type="range"
                    min={Math.round(state.market.price * 0.7 / 2.5) * 2.5}
                    max={Math.round(state.market.price * 1.3 / 2.5) * 2.5}
                    step="2.5"
                    value={effective.legs[0].strike}
                    onChange={(e) =>
                      update({
                        legs: [
                          { ...effective.legs[0], strike: Number(e.target.value) },
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

              {advanced && (
                <>
                  <SizingControl
                    desk={desk}
                    terms={effective}
                    onApply={(terms) => update(terms)}
                  />
                  {draft.curve ? (
                    <CurveEditor draft={draft} update={update} />
                  ) : (
                    <ContractLegEditor
                      draft={draft}
                      update={update}
                      mode={tab}
                      advanced
                    />
                  )}
                </>
              )}

              <Scoreboard
                risk={-Math.min(0, outcome.worst)}
                reward={outcome.best}
                capped={outcome.capped}
                floored={outcome.floored}
                riskAt={outcome.riskAt}
                breakEven={outcome.breakEven}
                premium={g.price}
                decimals={effective.reference === 'dividend' ? 4 : 2}
                invalid={invalid}
              />

              <div className="od-lines">
                <Line
                  label="Cash to fund it standalone"
                  value={
                    invalid
                      ? '—'
                      : usd(
                          Math.max(0, g.price) +
                            Number(cashBound < 0n ? -cashBound : 0n) / 1e6,
                        )
                  }
                />
                <Line
                  label="Settlement"
                  value={
                    draft.settlement === 'physical'
                      ? 'Fully funded physical delivery'
                      : 'Cash, capped obligations'
                  }
                  tone="muted"
                />
                <Line
                  label="Collateral mode"
                  value={state.book.margin === 'cross' ? 'Cross' : 'Isolated'}
                  tone="muted"
                />
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
                Physical buyers prefund exercise cash or shares on top of the
                premium. The quote shows the full requirement.
              </p>
            </div>
          </Panel>

          {/* ---------------- the picture ---------------- */}
          <div className="od-insight">
            <Panel>
              <PanelHead
                title={effective.name}
                description={
                  invalid
                    ? 'Choose valid terms to price it.'
                    : `${qty(effective.quantity)} share-equivalents, ${expiryLabel(effective.expiry)}`
                }
                action={<Badge tone="accent">Expiry payoff</Badge>}
              />
              {!invalid ? (
                <PayoffChart
                  terms={effective}
                  stockQuantity={includedStock}
                  premium={g.price}
                  spot={reference}
                  shock={shock}
                  onShock={setShock}
                />
              ) : (
                <Empty title="Choose valid terms" description={validationError} />
              )}
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
                {advanced && (
                  <Stat
                    label="Vega per vol point"
                    value={usd(g.vega, 4)}
                    detail="Modelled vol sensitivity"
                  />
                )}
                {advanced && (
                  <Stat
                    label="Gamma"
                    value={g.gamma.toFixed(4)}
                    detail="Delta change per $1"
                  />
                )}
              </div>
              <div className="od-panel-foot">
                <span>Pricing basis</span>
                <span>
                  {effective.reference === 'dividend'
                    ? 'Committed dividend event'
                    : session.includes('T')
                      ? 'Daily close carried forward'
                      : 'Stored historical close'}
                  {' — Black-Scholes at '}
                  {(vol * 100).toFixed(0)}% vol, reference{' '}
                  {usd(reference, effective.reference === 'dividend' ? 4 : 2)}
                </span>
              </div>
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
        </div>
      )}

      <Panel>
        <PanelHead
          title="Open contracts"
          description="Expiry groups settle together to preserve collateral offsets."
          action={
            <Badge tone={active.length ? 'accent' : 'neutral'}>
              {active.length} active
            </Badge>
          }
        />
        {active.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th className="num">Quantity</th>
                  <th>Expiry</th>
                  <th className="num">Premium</th>
                  <th>Settlement</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.terms.name}</b>
                      <small>{p.id.slice(0, 8).toUpperCase()}</small>
                    </td>
                    <td className="num">{qty(p.terms.quantity)}</td>
                    <td>{expiryLabel(p.terms.expiry)}</td>
                    <td className="num">
                      {p.premium >= 0 ? 'Paid' : 'Received'}{' '}
                      {usd(
                        Math.abs(p.premium),
                        p.terms.reference === 'dividend' ? 4 : 2,
                      )}
                    </td>
                    <td>{p.terms.settlement}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={requesting || desk.busy}
                        onClick={() => {
                          setRequesting(true);
                          void desk
                            .closeQuote(p.id)
                            .then(setQuote)
                            .catch((e) => desk.setToast((e as Error).message))
                            .finally(() => setRequesting(false));
                        }}
                      >
                        Close
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your next contract starts here"
            description="Request a quote to see the exact premium and collateral needed before you commit."
          />
        )}
      </Panel>

      {!advanced && tab === 'trade' && (
        <button className="od-chain-cue" onClick={() => setBrowse(true)}>
          <Table2 size={15} />
          Looking for a specific strike? The full options chain is in Advanced.
        </button>
      )}

      {/* The same contract, against a different kind of underlying. It
          is a separate desk because the collateral is a mint this vault
          does not hold, not because it is a different product. */}
      {tab === 'underwrite' && (
        <button className="od-chain-cue" onClick={openPreIpo}>
          <Rocket size={15} />
          Writing against a pre-IPO token instead? Covered calls on sponsor
          tokens are underwritten on the Pre-IPO desk.
        </button>
      )}

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
