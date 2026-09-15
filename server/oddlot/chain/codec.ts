import { createHash } from 'node:crypto';
import type { OrderTerms, VaultBook } from '../../../lib/oddlot/types';
import type { VaultPlan } from '../service';
import { clockRows } from '../../../lib/oddlot/market';
import { signedUnits } from '../../../lib/oddlot/math';
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
export const date = (v: string) => {
  const n = clockRows.findIndex((r) => r.date === v);
  if (n < 0) throw Error('Unknown historical date.');
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
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
      (p) =>
        cat(
          id(p.id),
          amount(p.quantity),
          date(p.opened),
          date(p.expiry),
          amount(p.cap),
          amount(p.maxInterest),
        ),
    ),
  );
}
export const bookHash = (b: VaultBook) =>
  createHash('sha256').update(bookBytes(b)).digest();
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
    default:
      throw Error('Unsupported onchain vault action.');
  }
}
