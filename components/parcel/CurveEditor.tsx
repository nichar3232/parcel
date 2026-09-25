'use client';
import type { OrderTerms } from '@/lib/parcel/types';
import { Field, usd } from './shared';
export function CurveEditor({
  draft,
  update,
}: {
  draft: OrderTerms;
  update: (patch: Partial<OrderTerms>) => void;
}) {
  const curve = draft.curve!;
  const patch = (value: Partial<typeof curve>) =>
    update({ curve: { ...curve, ...value } });
  return (
    <div className="od-curve-editor">
      <div className="od-form-grid">
        <Field label="Curve side">
          <select
            value={curve.side}
            onChange={(e) => patch({ side: e.target.value as 'buy' | 'sell' })}
          >
            <option value="buy">Buy convexity</option>
            <option value="sell">Underwrite convexity</option>
          </select>
        </Field>
        <Field label="Direction">
          <select
            value={curve.direction}
            onChange={(e) =>
              patch({ direction: e.target.value as 'up' | 'down' })
            }
          >
            <option value="up">Pay more as reference rises</option>
            <option value="down">Pay more as reference falls</option>
          </select>
        </Field>
        <Field label="Curve shape">
          <select
            value={curve.shape}
            onChange={(e) =>
              patch({ shape: e.target.value as 'quadratic' | 'exponential' })
            }
          >
            <option value="quadratic">Quadratic, x²</option>
            <option value="exponential">Exponential, normalised exp(4x)</option>
          </select>
        </Field>
        {(['lower', 'upper', 'cap'] as const).map((key) => (
          <Field
            key={key}
            label={
              key === 'cap'
                ? 'Payout cap per share'
                : `${key === 'lower' ? 'Lower' : 'Upper'} boundary`
            }
          >
            <input
              type="number"
              step="any"
              value={Number.isNaN(curve[key]) ? '' : curve[key]}
              onChange={(e) =>
                patch({
                  [key]: e.target.value === '' ? NaN : Number(e.target.value),
                })
              }
            />
          </Field>
        ))}
      </div>
      <p className="od-form-note">
        Cash payoff is clipped to this range. Maximum obligation:{' '}
        {Number.isFinite(curve.cap * draft.quantity)
          ? usd(curve.cap * draft.quantity)
          : '—'}
        . The writer locks this amount; an identical opposite contract may
        offset it.
      </p>
    </div>
  );
}
