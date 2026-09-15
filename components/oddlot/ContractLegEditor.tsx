'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { OrderTerms } from '@/lib/oddlot/types';
import { Button, Field } from './shared';
export function ContractLegEditor({
  draft,
  update,
  mode,
}: {
  draft: OrderTerms;
  update: (patch: Partial<OrderTerms>) => void;
  mode: 'trade' | 'underwrite' | 'structures';
}) {
  return (
    <>
      <div className="od-legs-label">
        <span>CONTRACT LEGS</span>
        <span>{draft.legs.length} of 4</span>
      </div>
      {draft.legs.map((l, i) => (
        <div key={i} className="od-leg">
          <span className={`od-leg-side ${l.side}`}>
            {l.side === 'buy' ? '+' : '−'}
          </span>
          <Field label={`Leg ${i + 1} side`}>
            <select
              value={l.side}
              onChange={(e) =>
                update({
                  legs: draft.legs.map((x, j) =>
                    j === i
                      ? { ...x, side: e.target.value as 'buy' | 'sell' }
                      : x,
                  ),
                })
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
                update({
                  legs: draft.legs.map((x, j) =>
                    j === i
                      ? { ...x, kind: e.target.value as 'call' | 'put' }
                      : x,
                  ),
                })
              }
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </Field>
          <Field label={`Leg ${i + 1} strike`}>
            <input
              type="number"
              step="any"
              min="0.000001"
              value={l.strike || ''}
              onChange={(e) =>
                update({
                  legs: draft.legs.map((x, j) =>
                    j === i ? { ...x, strike: Number(e.target.value) } : x,
                  ),
                })
              }
            />
          </Field>
          <Field label={`Leg ${i + 1} ratio`}>
            <select
              value={l.ratio}
              onChange={(e) =>
                update({
                  legs: draft.legs.map((x, j) =>
                    j === i ? { ...x, ratio: Number(e.target.value) } : x,
                  ),
                })
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </Field>
          {mode === 'structures' && draft.legs.length > 1 && (
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
      {mode === 'structures' && draft.legs.length < 4 && (
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
      {mode === 'structures' && (
        <Field label="Settlement">
          <select
            value={draft.settlement}
            onChange={(e) =>
              update({
                settlement: e.target.value as 'cash' | 'physical',
              })
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
