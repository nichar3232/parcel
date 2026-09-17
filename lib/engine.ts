import history from '../data/history.json';
/** Prices and quantities use 6 decimal base units. Payout rounds down once. */
export type Kind = 'put' | 'call';
export interface Terms {
  kind: Kind;
  low: number;
  high: number;
  quantity: number;
  premium: number;
  expiry: string;
  scenario: string;
}
export const SCALE = BigInt(1_000_000);
export function units(n: number): bigint {
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 1e9 ||
    Math.abs(n * 1e6 - Math.round(n * 1e6)) > 0.001
  )
    throw Error('Use a nonnegative amount with at most six decimals.');
  return BigInt(Math.round(n * 1e6));
}
export function validate(t: Terms) {
  if (!['put', 'call'].includes(t.kind))
    throw Error('Choose a supported spread.');
  if (t.low <= 0 || t.high <= t.low || t.high > 1e6)
    throw Error('The upper strike must exceed the lower strike.');
  if (t.quantity <= 0 || t.quantity > 1000)
    throw Error('Size must be between 0.000001 and 1,000 shares.');
  [t.low, t.high, t.quantity, t.premium].forEach(units);
  if (maximum(t) <= 0)
    throw Error(
      'The maximum payout must be at least one settlement base unit.',
    );
  if (t.premium > maximum(t))
    throw Error('Premium cannot exceed the maximum payout.');
  if (!history.rows.some((row) => row.date === t.expiry))
    throw Error('Choose a historical settlement session.');
}
export function maximum(t: Pick<Terms, 'low' | 'high' | 'quantity'>) {
  return (
    Number(((units(t.high) - units(t.low)) * units(t.quantity)) / SCALE) / 1e6
  );
}
export function payout(t: Terms, price: number) {
  validate(t);
  const s = units(price),
    l = units(t.low),
    h = units(t.high);
  let intrinsic = t.kind === 'put' ? h - s : s - l;
  intrinsic =
    intrinsic < BigInt(0) ? BigInt(0) : intrinsic > h - l ? h - l : intrinsic;
  return Number((intrinsic * units(t.quantity)) / SCALE) / 1e6;
}
export const money = (n: number, d = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
export const signed = (n: number) =>
  `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
export const net = (t: Terms, s: number) => payout(t, s) - t.premium;
export function breakEven(t: Terms) {
  if (maximum(t) <= 0)
    throw Error(
      'The maximum payout must be at least one settlement base unit.',
    );
  if (t.premium > maximum(t)) return null;
  return t.kind === 'put'
    ? t.high - t.premium / t.quantity
    : t.low + t.premium / t.quantity;
}
export type Status =
  | 'requested'
  | 'funded'
  | 'active'
  | 'awaiting'
  | 'settled'
  | 'closed'
  | 'cancelled';
export interface Position {
  id: string;
  terms: Terms;
  status: Status;
  createdAt: number;
  deadline: number;
  reserve: number;
  buyerPayout: number;
  buyerClaimed: boolean;
  makerClaimed: boolean;
  settlementPrice?: number;
}
export interface Event {
  id: string;
  time: number;
  title: string;
  detail: string;
  type: 'success' | 'info' | 'error';
  position?: string;
}
export interface Book {
  version: 1;
  holderCash: number;
  makerCash: number;
  positions: Position[];
  events: Event[];
}
export function initialBook(): Book {
  return {
    version: 1,
    holderCash: 10000,
    makerCash: 50000,
    positions: [],
    events: [],
  };
}
const credit = (balance: number, value: number) =>
  Number(units(balance) + units(value)) / 1e6;
const debit = (balance: number, value: number) => {
  const result = units(balance) - units(value);
  if (result < BigInt(0)) throw Error('Insufficient available balance.');
  return Number(result) / 1e6;
};
export type Action =
  | { type: 'request'; terms: Terms; id: string; now: number }
  | { type: 'fund'; id: string; premium: number; now: number }
  | { type: 'accept' | 'cancel' | 'expire'; id: string; now: number }
  | {
      type: 'settle';
      id: string;
      price: number;
      date: string;
      available: boolean;
      now: number;
    }
  | { type: 'claim'; id: string; party: 'holder' | 'maker'; now: number };
export function transition(old: Book, a: Action): Book {
  if (!Number.isSafeInteger(a.now) || a.now < 0)
    throw Error('Invalid action clock.');
  const b: Book = structuredClone(old);
  const now = a.now;
  const emit = (title: string, detail: string) =>
    b.events.unshift({
      id: `${now}-${b.events.length}`,
      time: now,
      title,
      detail,
      type: 'success',
      position: a.id,
    });
  if (a.type === 'request') {
    validate(a.terms);
    if (b.positions.some((p) => p.id === a.id))
      throw Error('Request already exists.');
    b.positions.unshift({
      id: a.id,
      terms: { ...a.terms },
      status: 'requested',
      createdAt: now,
      deadline: 0,
      reserve: maximum(a.terms),
      buyerPayout: 0,
      buyerClaimed: false,
      makerClaimed: false,
    });
    emit(
      'Quote requested',
      `${a.terms.quantity} NVDA ${a.terms.kind} spread — awaiting demo maker`,
    );
    return b;
  }
  const p = b.positions.find((p) => p.id === a.id);
  if (!p) throw Error('Position was not found.');
  if (a.type === 'fund') {
    if (p.status !== 'requested')
      throw Error('This request already has a quote.');
    p.terms.premium = a.premium;
    validate(p.terms);
    if (b.makerCash < p.reserve)
      throw Error('Maker has insufficient available collateral.');
    b.makerCash = debit(b.makerCash, p.reserve);
    p.status = 'funded';
    p.deadline = now + 120000;
    emit(
      'Maker funded the offer',
      `${money(p.reserve)} demo USDC reserved. Quote valid for two minutes.`,
    );
  }
  if (a.type === 'accept') {
    if (p.status !== 'funded')
      throw Error('Only a funded offer can be accepted.');
    if (now >= p.deadline)
      throw Error(
        'The quote expired. Reclaim it in Maker and request a new quote.',
      );
    if (b.holderCash < p.terms.premium)
      throw Error('Insufficient available demo USDC.');
    b.holderCash = debit(b.holderCash, p.terms.premium);
    b.makerCash = credit(b.makerCash, p.terms.premium);
    p.status = 'active';
    emit(
      'Protection activated',
      `${money(p.terms.premium)} premium paid — zero fees — full reserve locked`,
    );
  }
  if (a.type === 'cancel' || a.type === 'expire') {
    if (p.status !== 'funded')
      throw Error('An active trade cannot be cancelled.');
    if (a.type === 'expire' && now < p.deadline)
      throw Error('The offer has not expired.');
    b.makerCash = credit(b.makerCash, p.reserve);
    p.status = 'cancelled';
    emit(
      'Unfilled reserve returned',
      `${money(p.reserve)} returned to the demo maker`,
    );
  }
  if (a.type === 'settle') {
    if (['settled', 'closed'].includes(p.status)) return old;
    if (!['active', 'awaiting'].includes(p.status))
      throw Error('Accept the offer before settlement.');
    if (a.date < p.terms.expiry)
      throw Error('Advance the replay to the contracted settlement session.');
    const committed = history.rows.find((row) => row.date === p.terms.expiry);
    if (!committed || a.price !== committed.close)
      throw Error(
        'Settlement must use the exact committed historical observation.',
      );
    if (!a.available) {
      p.status = 'awaiting';
      emit(
        'Awaiting historical observation',
        'Collateral remains locked. Retry after the committed sample is available.',
      );
    } else {
      p.buyerPayout = payout(p.terms, a.price);
      p.settlementPrice = a.price;
      p.status = 'settled';
      emit(
        'Settlement fixed',
        `${money(a.price)} reference — ${money(p.buyerPayout)} holder entitlement`,
      );
    }
  }
  if (a.type === 'claim') {
    if (p.status !== 'settled')
      throw Error('This position has no unpaid settlement.');
    if (a.party === 'holder') {
      if (p.buyerClaimed) throw Error('Holder already claimed.');
      b.holderCash = credit(b.holderCash, p.buyerPayout);
      p.buyerClaimed = true;
    } else {
      if (p.makerClaimed) throw Error('Maker already claimed.');
      b.makerCash = credit(
        b.makerCash,
        Number(units(p.reserve) - units(p.buyerPayout)) / 1e6,
      );
      p.makerClaimed = true;
    }
    if (p.buyerClaimed && p.makerClaimed) p.status = 'closed';
    emit(
      `${a.party === 'holder' ? 'Holder' : 'Maker'} claimed`,
      `${money(a.party === 'holder' ? p.buyerPayout : p.reserve - p.buyerPayout)} returned to available cash`,
    );
  }
  return b;
}
export function reserved(p: Position) {
  if (['requested', 'cancelled', 'closed'].includes(p.status)) return 0;
  if (p.status === 'settled')
    return (
      (p.buyerClaimed ? 0 : p.buyerPayout) +
      (p.makerClaimed ? 0 : p.reserve - p.buyerPayout)
    );
  return p.reserve;
}
export function conservation(b: Book) {
  return (
    b.holderCash +
    b.makerCash +
    b.positions.reduce((s, p) => s + reserved(p), 0)
  );
}
