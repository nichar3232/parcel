'use client';
import { useRef, useState } from 'react';
import { ArrowRight, ChevronRight, LockKeyhole } from 'lucide-react';
import type { ExploreDraft } from '@/lib/oddlot/explore';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { OrderTerms, Quote } from '@/lib/oddlot/types';
import { deliveryBounds } from '@/lib/oddlot/envelope';
import { bounded, orderGreeks } from '@/lib/oddlot/math';
import { parseOrderTerms } from '@/lib/oddlot/validation';
import { templates, templateTerms } from '@/lib/oddlot/templates';
import { selectableExpiries } from '@/lib/oddlot/market';
import { CurveEditor } from './CurveEditor';
import { SizingControl } from './SizingControl';
import { OptionsChain } from './OptionsChain';
import { PayoffChart } from './PayoffChart';
import { QuoteReview } from './QuoteReview';
import { ContractLegEditor } from './ContractLegEditor';
import {
  Badge,
  Button,
  Empty,
  Field,
  Heading,
  Panel,
  Stat,
  dateLabel,
  qty,
  usd,
} from './shared';
export function OptionsView({
  desk,
  mode,
  initialDraft,
}: {
  desk: VaultController;
  mode: 'trade' | 'underwrite' | 'structures';
  initialDraft?: ExploreDraft;
}) {
  const state = desk.state!;
  const future = selectableExpiries(state.book.date),
    defaultExpiry =
      future.find((d) => d >= '2025-02-07') || future[0] || state.book.date;
  const [advanced, setAdvanced] = useState(false),
    [browse, setBrowse] = useState(false),
    [category, setCategory] = useState('Direction');
  const [selected, setSelected] = useState(
    initialDraft?.templateId ||
      (mode === 'underwrite'
        ? 'covered-call'
        : mode === 'structures'
          ? 'call-spread'
          : 'call'),
  );
  const [draft, setDraft] = useState<OrderTerms>(
      () => initialDraft?.terms || templateTerms(selected, defaultExpiry),
    ),
    [quote, setQuote] = useState<Quote | null>(null),
    [requesting, setRequesting] = useState(false),
    [error, setError] = useState('');
  const effective = {
    ...draft,
    expiry:
      draft.reference === 'dividend'
        ? '2025-03-12'
        : draft.expiry > state.book.date
          ? draft.expiry
          : defaultExpiry,
  };
  let validationError = '';
  try {
    parseOrderTerms(effective, state.book.date);
  } catch (e) {
    validationError = (e as Error).message;
  }
  const invalid = !!validationError;
  const draftRevision = useRef(0);
  const g = invalid
    ? { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 }
    : orderGreeks(
        effective,
        effective.reference === 'dividend'
          ? state.market.dividend
          : state.market.price,
        state.book.date,
        effective.reference === 'dividend' ? 0.8 : state.market.volatility,
      );
  const includedStock =
    !invalid &&
    ['covered-call', 'put', 'collar'].includes(selected) &&
    effective.reference === 'stock'
      ? effective.quantity
      : 0;
  const cashBound = !invalid ? deliveryBounds([effective]).cashMin : 0n;
  const select = (id: string) => {
    draftRevision.current++;
    setSelected(id);
    setDraft(templateTerms(id, defaultExpiry));
    setError('');
    setQuote(null);
  };
  const update = (patch: Partial<OrderTerms>) => {
    draftRevision.current++;
    setDraft((d) => ({ ...d, ...patch }));
    setQuote(null);
    setError('');
  };
  const request = async () => {
    const requestedDraft = draftRevision.current;
    setRequesting(true);
    setError('');
    try {
      const result = await desk.quote(effective);
      if (draftRevision.current === requestedDraft) setQuote(result);
    } catch (e) {
      if (draftRevision.current === requestedDraft)
        setError((e as Error).message);
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
    mode === 'trade'
      ? ['call', 'put'].includes(t.id)
      : mode === 'underwrite'
        ? ['covered-call', 'secured-put'].includes(t.id)
        : !['call', 'put', 'covered-call', 'secured-put'].includes(t.id),
  );
  return (
    <>
      <Heading
        eyebrow={
          mode === 'underwrite'
            ? 'YOUR SHARES CAN WRITE THE CONTRACT'
            : mode === 'structures'
              ? 'COMPOSE YOUR EXPOSURE'
              : 'OPTIONS, BY THE SHARE'
        }
        title={
          mode === 'underwrite'
            ? 'Underwrite what you can cover.'
            : mode === 'structures'
              ? 'A structure for your point of view.'
              : 'Your exposure. Your size.'
        }
        description={
          mode === 'underwrite'
            ? 'Premium income starts with fully reserved shares or cash. Nothing gets pledged twice.'
            : mode === 'structures'
              ? 'Combine direction, volatility, and dividend exposure in a single reviewed contract.'
              : 'Choose your exposure without a 100-share minimum. Size down to a fraction of a share.'
        }
      />
      <div className="od-workflow-bar">
        <div className="od-segmented">
          <button
            className={!advanced ? 'selected' : ''}
            onClick={() => setAdvanced(false)}
          >
            Basic
          </button>
          <button
            className={advanced ? 'selected' : ''}
            onClick={() => setAdvanced(true)}
          >
            Advanced
          </button>
        </div>
        {mode === 'trade' && (
          <div className="od-segmented">
            <button
              className={!browse ? 'selected' : ''}
              onClick={() => setBrowse(false)}
            >
              Contract builder
            </button>
            <button
              className={browse ? 'selected' : ''}
              onClick={() => {
                draftRevision.current++;
                setQuote(null);
                setBrowse(true);
              }}
            >
              Options chain
            </button>
          </div>
        )}
      </div>
      {browse && mode === 'trade' && (
        <OptionsChain
          desk={desk}
          onSelect={(terms) => {
            draftRevision.current++;
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
      {mode === 'structures' && (
        <div className="od-category-tabs">
          {[
            'Direction',
            'Volatility',
            'Convexity',
            'Dividends',
            'Cash flow',
          ].map((c) => (
            <button
              key={c}
              className={category === c ? 'selected' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {mode === 'structures' && (
        <div className="od-template-grid">
          {choices
            .filter((t) =>
              category === 'Dividends'
                ? t.reference === 'dividend'
                : category === 'Convexity'
                  ? !!t.curve
                  : category === 'Cash flow'
                    ? t.id === 'box'
                    : category === 'Volatility'
                      ? [
                          'straddle',
                          'strangle',
                          'condor',
                          'butterfly',
                        ].includes(t.id)
                      : ['call-spread', 'put-spread', 'collar'].includes(t.id),
            )
            .map((t) => (
              <button
                key={t.id}
                className={`od-template ${selected === t.id ? 'selected' : ''}`}
                onClick={() => select(t.id)}
              >
                <span>{t.tag}</span>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <ChevronRight size={16} />
              </button>
            ))}
        </div>
      )}
      {(!browse || mode !== 'trade') && (
        <div className="od-builder-grid">
          <Panel className="od-order-form">
            <div className="od-panel-heading">
              <h2>
                {mode === 'underwrite'
                  ? 'Write an option'
                  : 'Build your contract'}
              </h2>
              <Badge>NVDA</Badge>
            </div>
            {mode !== 'structures' && (
              <div className="od-segmented">
                {choices.map((t) => (
                  <button
                    className={selected === t.id ? 'selected' : ''}
                    key={t.id}
                    onClick={() => select(t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <div className="od-form-content">
              <div className="od-form-grid">
                <Field
                  label="Share-equivalent quantity"
                  help="Share-equivalents describe exposure, not a minimum lot."
                >
                  <input
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
                </Field>
                <Field label="Expiration">
                  <select
                    value={effective.expiry}
                    onChange={(e) => update({ expiry: e.target.value })}
                    disabled={effective.reference === 'dividend'}
                  >
                    {(effective.reference === 'dividend'
                      ? ['2025-03-12']
                      : future
                    ).map((d) => (
                      <option key={d} value={d}>
                        {dateLabel(d)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
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
                  mode={mode}
                  advanced={advanced}
                />
              )}
              <div className="od-order-summary">
                {!invalid && (
                  <div>
                    <span>Standalone cash funding</span>
                    <b>
                      {usd(
                        Math.max(0, g.price) +
                          Number(cashBound < 0n ? -cashBound : 0n) / 1e6,
                      )}
                    </b>
                  </div>
                )}
                <div>
                  <span>
                    {g.price >= 0
                      ? 'Estimated premium paid'
                      : 'Estimated premium received'}
                  </span>
                  <b>
                    {usd(
                      Math.abs(g.price),
                      effective.reference === 'dividend' ? 4 : 2,
                    )}
                  </b>
                </div>
                <div>
                  <span>Settlement</span>
                  <span>
                    {draft.settlement === 'physical'
                      ? 'Fully funded physical delivery'
                      : 'Cash, capped obligations'}
                  </span>
                </div>
                <div>
                  <span>Collateral mode</span>
                  <span>
                    {state.book.margin === 'cross' ? 'Cross' : 'Isolated'}
                  </span>
                </div>
              </div>
              {error && (
                <p className="od-error" role="alert">
                  {error}
                </p>
              )}
              {!bounded(draft.legs) && draft.settlement === 'cash' && (
                <p className="od-form-note">
                  This payoff has an uncapped upside leg. Choose physical
                  settlement or add a cap.
                </p>
              )}
              <Button
                onClick={() => void request()}
                disabled={invalid || requesting || desk.busy}
              >
                {requesting ? 'Checking collateral…' : 'Review funded quote'}
                <ArrowRight size={16} />
              </Button>
              <p className="od-form-note">
                <LockKeyhole size={12} />
                Physical buyers prefund exercise cash or delivery shares in
                addition to premium. Cash spreads fund their bounded obligation.
                The quote shows the full requirement.
              </p>
            </div>
          </Panel>
          <div className="od-builder-insight">
            <Panel>
              <div className="od-panel-heading">
                <h2>See the shape of your trade</h2>
                <Badge tone="neutral">Expiry payoff</Badge>
              </div>
              {!invalid ? (
                <PayoffChart
                  terms={effective}
                  stockQuantity={includedStock}
                  premium={g.price}
                  spot={
                    effective.reference === 'dividend'
                      ? state.market.dividend
                      : state.market.price
                  }
                />
              ) : (
                <Empty
                  title="Choose valid terms"
                  description={validationError}
                />
              )}
              <div className="od-greeks">
                <Stat
                  label="P&L / +1¢ reference"
                  value={usd((g.delta + includedStock) * 0.01, 6)}
                  detail="Local estimate; changes with the market"
                />
                <Stat
                  label={
                    includedStock ? 'Stock + option delta' : 'Option delta'
                  }
                  value={(g.delta + includedStock).toFixed(3)}
                  detail="Shares of price exposure"
                />
                <Stat
                  label="Theta / day"
                  value={usd(g.theta, 4)}
                  detail="Position-level dollar decay"
                />
                {advanced && (
                  <Stat
                    label="Vega / 1 vol pt"
                    value={usd(g.vega, 4)}
                    detail="Modeled volatility sensitivity"
                  />
                )}
              </div>
              <div className="od-panel-foot od-basis">
                <span>Pricing basis</span>
                <span>
                  {effective.reference === 'dividend'
                    ? 'Committed dividend event'
                    : state.book.date.includes('T')
                      ? 'Daily close carried forward'
                      : 'Stored historical close'}{' '}
                  · Test model{' '}
                  {effective.reference === 'dividend' ? '80' : '45'}% vol · Ref{' '}
                  {usd(
                    effective.reference === 'dividend'
                      ? state.market.dividend
                      : state.market.price,
                    effective.reference === 'dividend' ? 4 : 2,
                  )}
                </span>
              </div>
            </Panel>
          </div>
        </div>
      )}
      <Panel>
        <div className="od-panel-heading">
          <div>
            <h2>Open contracts</h2>
            <p>Expiry groups settle together to preserve collateral offsets.</p>
          </div>
          <Badge tone="neutral">{active.length} active</Badge>
        </div>
        {active.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Quantity</th>
                  <th>Expiry</th>
                  <th>Premium</th>
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
                    <td>{qty(p.terms.quantity)}</td>
                    <td>{dateLabel(p.terms.expiry)}</td>
                    <td>
                      {p.premium >= 0 ? 'Paid' : 'Received'}{' '}
                      {usd(
                        Math.abs(p.premium),
                        p.terms.reference === 'dividend' ? 4 : 2,
                      )}
                    </td>
                    <td>{p.terms.settlement}</td>
                    <td>
                      <Button
                        variant="quiet"
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
            title="Your next contract starts here."
            description="Request a quote to see the exact premium and collateral needed before you commit."
          />
        )}
      </Panel>
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
