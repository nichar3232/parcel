'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { Leg, OrderTerms } from '@/lib/parcel/types';
import { Button, Field } from './shared';
export function ContractLegEditor({
  draft,
  update,
  mode,
  advanced = true,
}: {
  draft: OrderTerms;
  update: (patch: Partial<OrderTerms>) => void;
  mode: 'trade' | 'underwrite' | 'structures';
  advanced?: boolean;
}) {
  const change = (i: number, patch: Partial<Leg>) =>
    update({
      legs: draft.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    });
  return (
    <>
      <div className="od-legs-label">
        <span>CONTRACT LEGS</span>
        <span>{draft.legs.length} of 4</span>
      </div>
      {draft.legs.map((l, i) => (
        <div key={i} className={advanced ? 'od-leg' : 'od-basic-leg'}>
          <span className={`od-leg-side ${l.side}`}>
            {l.side === 'buy' ? '+' : '−'}
          </span>
          {advanced ? (
            <>
              <Field label={`Leg ${i + 1} side`}>
                <select
                  value={l.side}
                  onChange={(e) =>
                    change(i, { side: e.target.value as Leg['side'] })
                  }
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </Field>
              <Field label={`Leg ${i + 1} type`}>
                <select
                  value={l.kind}
                  onChange={(e) =>
                    change(i, { kind: e.target.value as Leg['kind'] })
                  }
                >
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </Field>
            </>
          ) : (
            <strong>
              {l.side === 'buy' ? 'Buy' : 'Sell'} {l.ratio}× {l.kind}
            </strong>
          )}
          <Field label={`Leg ${i + 1} strike`}>
            <input
              type="number"
              step="any"
              min="0.000001"
              value={l.strike || ''}
              onChange={(e) => change(i, { strike: Number(e.target.value) })}
            />
          </Field>
          {advanced && (
            <Field label={`Leg ${i + 1} ratio`}>
              <select
                value={l.ratio}
                onChange={(e) => change(i, { ratio: Number(e.target.value) })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </Field>
          )}
          {advanced && mode === 'structures' && draft.legs.length > 1 && (
            <button
              className="od-icon-button"
              aria-label={`Remove leg ${i + 1}`}
              onClick={() =>
                update({ legs: draft.legs.filter((_, j) => j !== i) })
              }
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {advanced && mode === 'structures' && draft.legs.length < 4 && (
        <Button
          variant="quiet"
          onClick={() =>
            update({
              legs: [
                ...draft.legs,
                { kind: 'call', side: 'buy', strike: 160, ratio: 1 },
              ],
            })
          }
        >
          <Plus size={14} />
          Add leg
        </Button>
      )}
      {advanced && mode === 'structures' && (
        <Field label="Settlement">
          <select
            value={draft.settlement}
            onChange={(e) =>
              update({ settlement: e.target.value as OrderTerms['settlement'] })
            }
          >
            <option value="cash">Cash · bounded payoff required</option>
            <option value="physical">Physical · shares and strike cash</option>
          </select>
        </Field>
      )}
    </>
  );
}
