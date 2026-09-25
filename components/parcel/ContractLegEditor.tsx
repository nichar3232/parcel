'use client';
import { Plus, X } from 'lucide-react';
import type { Leg, OrderTerms } from '@/lib/parcel/types';

/**
 * The legs, one line each.
 *
 * This was four labelled, full-width dropdowns per leg — side, type,
 * strike, ratio — with a trash can and a stray minus sign between legs,
 * so a two-leg spread was a page of form. A leg is one line now, read
 * the way a trader says it: buy · call · 230 · 1×. The column names are
 * said once, above the first line.
 */
export function ContractLegEditor({
  draft,
  update,
  mode,
}: {
  draft: OrderTerms;
  update: (patch: Partial<OrderTerms>) => void;
  mode: 'trade' | 'underwrite' | 'structures';
}) {
  const change = (i: number, patch: Partial<Leg>) =>
    update({
      legs: draft.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    });
  const editable = mode === 'structures';
  const last = draft.legs.at(-1);
  return (
    <div className="od-legs">
      <div className="od-legs-head">
        <span>Side</span>
        <span>Type</span>
        <span>Strike</span>
        <span>Ratio</span>
        <span />
      </div>
      {draft.legs.map((l, i) => (
        <div key={i} className="od-legs-row">
          <Toggle
            label={`Leg ${i + 1} side`}
            value={l.side}
            options={[
              ['buy', 'Buy'],
              ['sell', 'Sell'],
            ]}
            onChange={(side) => change(i, { side: side as Leg['side'] })}
          />
          <Toggle
            label={`Leg ${i + 1} type`}
            value={l.kind}
            options={[
              ['call', 'Call'],
              ['put', 'Put'],
            ]}
            onChange={(kind) => change(i, { kind: kind as Leg['kind'] })}
          />
          <input
            aria-label={`Leg ${i + 1} strike`}
            type="number"
            step="any"
            min="0.000001"
            value={l.strike || ''}
            onChange={(e) => change(i, { strike: Number(e.target.value) })}
          />
          <select
            aria-label={`Leg ${i + 1} ratio`}
            value={l.ratio}
            onChange={(e) => change(i, { ratio: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          {editable && draft.legs.length > 1 ? (
            <button
              className="od-legs-remove"
              aria-label={`Remove leg ${i + 1}`}
              onClick={() =>
                update({ legs: draft.legs.filter((_, j) => j !== i) })
              }
            >
              <X size={14} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {editable && (
        <div className="od-legs-foot">
          {draft.legs.length < 4 ? (
            <button
              className="od-legs-add"
              onClick={() =>
                update({
                  legs: [
                    ...draft.legs,
                    {
                      kind: last?.kind ?? 'call',
                      side: last?.side === 'buy' ? 'sell' : 'buy',
                      strike: last?.strike ?? 0,
                      ratio: 1,
                    },
                  ],
                })
              }
            >
              <Plus size={13} />
              Add leg
            </button>
          ) : (
            <span />
          )}
          <Toggle
            label="Settlement"
            value={draft.settlement}
            options={[
              ['physical', 'Physical'],
              ['cash', 'Cash'],
            ]}
            onChange={(settlement) =>
              update({ settlement: settlement as OrderTerms['settlement'] })
            }
          />
        </div>
      )}
    </div>
  );
}

/** Two choices in one small control, for inside a leg line. */
function Toggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="od-toggle" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={value === id ? 'on' : ''}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}
