import { units } from '../engine';
import { DIVIDEND_DATE, marketRows } from './market';
import { bounded } from './math';
import type { Leg, OrderTerms } from './types';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Provide an object with valid contract terms.');
  return value as Record<string, unknown>;
}
export function amount(value: unknown, min = 0.000001, max = 1000) {
  if (typeof value !== 'number' || value < min || value > max)
    throw Error(`Enter a number between ${min} and ${max}.`);
  return Number(units(value)) / 1e6;
}
export function expiry(value: unknown, date: string) {
  if (
    typeof value !== 'string' ||
    value <= date ||
    !marketRows.some((r) => r.date === value)
  )
    throw Error('Select a future session in the stored market window.');
  return value;
}
export function parseOrderTerms(value: unknown, date: string): OrderTerms {
  const t = object(value);
  if (typeof t.name !== 'string' || t.name.length < 1 || t.name.length > 70)
    throw Error('Provide a contract name of 1–70 characters.');
  if (t.reference !== 'stock' && t.reference !== 'dividend')
    throw Error('Choose a supported reference.');
  if (t.settlement !== 'cash' && t.settlement !== 'physical')
    throw Error('Choose cash or physical settlement.');
  if (!Array.isArray(t.legs) || t.legs.length < 1 || t.legs.length > 4)
    throw Error('A contract needs one to four option legs.');
  const legs = t.legs.map((value): Leg => {
    const l = object(value);
    if (l.kind !== 'call' && l.kind !== 'put')
      throw Error('Choose call or put.');
    if (l.side !== 'buy' && l.side !== 'sell')
      throw Error('Choose buy or sell.');
    return {
      kind: l.kind,
      side: l.side,
      strike: amount(l.strike, 0.000001, 10000),
      ratio: amount(l.ratio, 1, 4),
    };
  });
  if (legs.some((l) => !Number.isInteger(l.ratio)))
    throw Error('Leg ratios must be whole numbers.');
  if (t.settlement === 'cash' && !bounded(legs))
    throw Error(
      'Unbounded cash-settled calls require physical share backing. Use physical settlement or add a cap.',
    );
  const end = expiry(t.expiry, date);
  if (
    t.reference === 'dividend' &&
    (t.settlement !== 'cash' || end !== DIVIDEND_DATE)
  )
    throw Error(
      'Dividend contracts cash-settle at the committed March 12 event.',
    );
  if (t.reference === 'dividend' && legs.some((l) => l.strike > 0.1))
    throw Error('Dividend strikes use dollars per share, up to $0.10.');
  return {
    name: t.name,
    quantity: amount(t.quantity),
    expiry: end,
    reference: t.reference,
    settlement: t.settlement,
    legs,
  };
}
