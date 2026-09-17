'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { OrderTerms } from '@/lib/parcel/types';
import { Button, Field, qty, usd } from './shared';
export function SizingControl({
  desk,
  terms,
  onApply,
}: {
  desk: VaultController;
  terms: OrderTerms;
  onApply: (t: OrderTerms) => void;
}) {
  const [mode, setMode] = useState('premium'),
    [target, setTarget] = useState('5'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const latest = useRef('');
  useLayoutEffect(() => {
    latest.current = JSON.stringify([
      terms,
      mode,
      target,
      desk.state?.revision,
      desk.state?.csrf,
    ]);
  }, [terms, mode, target, desk.state?.revision, desk.state?.csrf]);
  const calculate = async () => {
    const request = latest.current;
    setBusy(true);
    setMessage('');
    try {
      const r = await desk.size(terms, mode, Number(target));
      if (request !== latest.current) return;
      onApply(r.terms);
      setMessage(
        `${qty(r.terms.quantity)} share-equivalents · ${usd(r.premium, 6)} premium · ${usd(r.cashFunding, 6)} standalone cash funding + ${qty(r.shares)} shares. Estimated P&L per +1¢: ${usd(r.centSensitivity, 6)}.${r.limited ? ' Maximum size reached.' : ''}`,
      );
    } catch (e) {
      if (request === latest.current) setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="od-sizing">
      <summary>Size by budget or price sensitivity</summary>
      <div className="od-form-grid">
        <Field label="Size by">
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setMessage('');
            }}
          >
            <option value="premium">Premium budget · USDC</option>
            <option value="sensitivity">
              Dollar P&L per 1¢ reference move
            </option>
            <option value="exposure">Share-equivalent exposure</option>
          </select>
        </Field>
        <Field label="Sizing target">
          <input
            type="number"
            min="0.000001"
            step="any"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setMessage('');
            }}
          />
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={busy || desk.pending}
        onClick={() => void calculate()}
      >
        {busy ? 'Calculating…' : 'Apply calculated size'}
      </Button>
      <p className="od-form-note">
        Premium budgets exclude exercise funding. Sensitivity is a local model
        estimate and changes with price, time and volatility.
      </p>
      {message && <output className="od-form-note">{message}</output>}
    </details>
  );
}
