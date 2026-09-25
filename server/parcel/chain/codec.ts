import { createHash } from 'node:crypto';
import type { OrderTerms, VaultBook } from '../../../lib/parcel/types';
import type { PlanTick, VaultPlan } from '../service';
import { storedMark } from '../../../lib/parcel/market';
import { signedUnits } from '../../../lib/parcel/math';
import { u64 } from '../../solana/codec';
const cat = (...parts: Uint8Array[]) => Buffer.concat(parts);
const byte = (n: number | boolean) => Buffer.from([Number(n)]);
const i64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(signedUnits(n));
  return b;
};
const amount = (n: number) => u64(signedUnits(n));
const id = (v: string) => {
  if (!/^[a-f0-9-]{36}$/.test(v)) throw Error('Invalid position identity.');
  return Buffer.from(v.replaceAll('-', ''), 'hex');
};
const vec = <T>(items: T[], encode: (item: T) => Buffer) => {
  const n = Buffer.alloc(4);
  n.writeUInt32LE(items.length);
  return cat(n, ...items.map(encode));
};
/** A variable loan's expiry: none, held as 0. */
const zero = Buffer.alloc(8);
/** The program stocks a single mint (NVDA in the test deployment). */
const assertProgramStock = (symbol: string) => {
  if (symbol !== 'NVDA')
    throw Error(
      'Onchain vault actions support the configured program stock mint (NVDA) only.',
    );
};
/**
 * A date as the program holds it: Unix milliseconds. A replay session
 * ('2025-02-03'), a replay tick ('2025-02-03T05:00:00Z'), a live instant
 * and a live expiry date all parse the same way; the program checks that
 * replay dates are observations it has a close for.
 */
export const date = (v: string) => {
  const ms = Date.parse(v);
  if (!Number.isSafeInteger(ms)) throw Error(`Invalid date ${v}.`);
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(ms));
  return b;
};
/** NVDA's price at the book's date: the attested live mark, or the stored close. */
const spot = (b: VaultBook) =>
  b.spot ?? storedMark('NVDA', b.date);
/** The clock a live action carries, as `Option<Tick>`. */
export const tick = (t: PlanTick | undefined) =>
  t
    ? cat(
        byte(1),
        date(t.date),
        amount(t.spot),
        vec(
          Object.entries(t.closes).sort(([a], [b]) => a.localeCompare(b)),
          ([at, price]) => cat(date(at), amount(price)),
        ),
        amount(t.apr ?? 0),
        byte(t.carry),
      )
    : byte(0);
export const terms = (t: OrderTerms) => {
  assertProgramStock(t.symbol);
  return cat(
    amount(t.quantity),
    date(t.expiry),
    byte(t.settlement === 'physical'),
    byte(t.reference === 'dividend'),
    vec(t.legs, (l) =>
      cat(
        byte(l.kind === 'call'),
        byte(l.side === 'buy'),
        amount(l.strike),
        byte(l.ratio),
      ),
    ),
    t.curve
      ? cat(
          byte(1),
          byte(t.curve.shape === 'exponential'),
          byte(t.curve.side === 'buy'),
          byte(t.curve.direction === 'up'),
          amount(t.curve.lower),
          amount(t.curve.upper),
          amount(t.curve.cap),
        )
      : byte(0),
  );
};
export function bookBytes(b: VaultBook) {
  return cat(
    date(b.date),
    amount(spot(b)),
    byte(b.margin === 'isolated'),
    ...[b.wallet, b.vault, b.counterparty, b.market].map((a) =>
      cat(amount(a.USDC), amount(a.NVDA)),
    ),
    vec(
      b.options.filter((p) => p.status === 'active'),
      (p) => cat(id(p.id), terms(p.terms)),
    ),
    vec(
      b.loans.filter((p) => p.status === 'active'),
      (p) => {
        if (!p.productive)
          throw Error('Legacy loans must be closed before onchain execution.');
        assertProgramStock(p.symbol);
        return cat(
          id(p.id),
          amount(p.quantity),
          date(p.opened),
          date(p.expiry),
          amount(p.productive.cap),
          amount(p.prepaidInterest),
        );
      },
    ),
    vec(
      b.shorts.filter((p) => p.status === 'active'),
      (p) => {
        assertProgramStock(p.symbol);
        return cat(
          id(p.id),
          amount(p.quantity),
          date(p.opened),
          date(p.expiry),
          amount(p.cap),
          amount(p.maxInterest),
        );
      },
    ),
    vec(
      b.borrows.filter((p) => p.status === 'active'),
      (p) => {
        assertProgramStock(p.symbol);
        return cat(
          id(p.id),
          amount(p.pledged),
          amount(p.principal),
          amount(p.apr),
          byte(p.rate === 'fixed'),
          date(p.opened),
          p.rate === 'fixed' && p.expiry ? date(p.expiry) : zero,
          amount(p.accrued),
          date(p.accruedTo),
        );
      },
    ),
  );
}
export const bookHash = (b: VaultBook) =>
  createHash('sha256').update(bookBytes(b)).digest();
/**
 * Vault actions the Parcel program encodes. Options open/close carry the
 * Black–Scholes (plus live spread) premium from the off-chain quote.
 * Stock-loan and protected-short premiums are also BS mids. Cash borrow APR
 * is the pool curve, authorized at open — not Black–Scholes.
 */
export const ONCHAIN_ACTIONS: ReadonlySet<string> = new Set([
  'transfer',
  'stock',
  'execute',
  'margin',
  'lend',
  'recall',
  'short',
  'close-short',
  'advance',
  'restart',
  'borrow',
  'repay',
]);
/**
 * The instruction's `tick` and `action` arguments. On the live market every
 * action carries the clock the book was synced to before it applied.
 */
export function actionBytes(p: VaultPlan) {
  if (p.before.clock === 'live' && !p.tick)
    throw Error('A live onchain action needs the clock it ran at.');
  return cat(tick(p.tick), action(p));
}
/** The variable-loan rate a replay advance repriced to, or 0 for none. */
function repriced(p: VaultPlan) {
  const variable = p.before.borrows.find(
    (o) => o.status === 'active' && o.rate === 'variable',
  );
  return variable ? p.book.borrows.find((o) => o.id === variable.id)!.apr : 0;
}
function action(p: VaultPlan) {
  const a = p.action,
    b = p.book;
  switch (a.type) {
    case 'transfer':
      return cat(
        byte(0),
        byte(a.direction === 'deposit'),
        byte(a.asset === 'NVDA'),
        amount(a.amount as number),
      );
    case 'stock':
      if (p.fill === undefined) throw Error('A stock order needs its fill.');
      return cat(
        byte(1),
        byte(a.side === 'buy'),
        amount(a.quantity as number),
        amount(p.fill),
      );
    case 'execute': {
      const opened = b.options.find(
        (o) => !p.before.options.some((old) => old.id === o.id),
      );
      if (opened)
        return cat(
          byte(2),
          id(opened.id),
          terms(opened.terms),
          i64(opened.premium),
        );
      const closed = b.options.find(
        (o) =>
          o.status === 'closed' &&
          p.before.options.some(
            (old) => old.id === o.id && old.status === 'active',
          ),
      );
      if (!closed) throw Error('No option transition in prepared plan.');
      return cat(byte(3), id(closed.id), i64(-closed.cashFlow!));
    }
    case 'margin':
      return cat(byte(4), byte(a.mode === 'isolated'));
    case 'lend': {
      const l = b.loans[0];
      assertProgramStock(l.symbol);
      return cat(
        byte(5),
        id(l.id),
        amount(l.quantity),
        date(l.expiry),
        amount(l.productive!.premium),
      );
    }
    case 'recall':
      return cat(byte(6), id(a.id as string));
    case 'short': {
      const s = b.shorts[0];
      assertProgramStock(s.symbol);
      return cat(
        byte(7),
        id(s.id),
        amount(s.quantity),
        amount(s.cap),
        date(s.expiry),
        amount(s.premium),
      );
    }
    case 'close-short':
      return cat(byte(8), id(a.id as string));
    case 'advance':
      return cat(
        byte(9),
        tick({
          date: a.date as string,
          spot: storedMark('NVDA', a.date as string),
          closes: {},
          apr: repriced(p),
          carry: true,
        }).subarray(1),
      );
    case 'restart':
      return byte(10);
    case 'borrow': {
      const opened = b.borrows.find(
        (o) => !p.before.borrows.some((old) => old.id === o.id),
      );
      if (!opened) throw Error('No cash borrow in prepared plan.');
      assertProgramStock(opened.symbol);
      return cat(
        byte(11),
        id(opened.id),
        amount(opened.pledged),
        amount(opened.principal),
        amount(opened.apr),
        byte(opened.rate === 'fixed'),
        opened.rate === 'fixed' && opened.expiry
          ? date(opened.expiry)
          : zero,
      );
    }
    case 'repay':
      return cat(byte(12), id(a.id as string));
    default:
      throw Error('Unsupported onchain vault action.');
  }
}
