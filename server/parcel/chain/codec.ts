import { createHash } from 'node:crypto';
import type { OrderTerms, VaultBook } from '../../../lib/parcel/types';
import type { VaultPlan } from '../service';
import { clockRows } from '../../../lib/parcel/market';
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
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
/** The program stocks a single mint (NVDA in the test deployment). */
const assertProgramStock = (symbol: string) => {
  if (symbol !== 'NVDA')
    throw Error(
      'Onchain vault actions support the configured program stock mint (NVDA) only.',
    );
};
export const date = (v: string) => {
  const n = clockRows.findIndex((r) => r.date === v);
  if (n < 0) throw Error('Unknown historical date.');
  return u16(n);
};
export const terms = (t: OrderTerms) =>
  cat(
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
export function bookBytes(b: VaultBook) {
  return cat(
    date(b.date),
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
          p.rate === 'fixed' && p.expiry ? date(p.expiry) : u16(0),
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
export function actionBytes(p: VaultPlan) {
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
      return cat(byte(1), byte(a.side === 'buy'), amount(a.quantity as number));
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
      return cat(byte(9), date(a.date as string));
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
          : u16(0),
      );
    }
    case 'repay':
      return cat(byte(12), id(a.id as string));
    default:
      throw Error('Unsupported onchain vault action.');
  }
}
