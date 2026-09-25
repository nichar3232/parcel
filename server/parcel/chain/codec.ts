import { createHash } from 'node:crypto';
import type { OrderTerms, VaultBook } from '../../../lib/parcel/types';
import type { PlanTick, VaultPlan } from '../service';
import { storedMark } from '../../../lib/parcel/market';
import { DEFAULT_UNDERLYING, UNDERLYINGS } from '../../../lib/parcel/universe';
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
/**
 * A stock as the program indexes it: its position in the universe, which
 * is the order the book's balances and the program's replay tables hold.
 */
export const stockIndex = (symbol: string) => {
  const i = UNDERLYINGS.findIndex((u) => u.symbol === symbol);
  if (i < 0) throw Error(`The onchain vault does not hold ${symbol}.`);
  return i;
};
const stock = (symbol: string) => byte(stockIndex(symbol));
/** An asset's column in the program's balances: cash, then every stock. */
export const assetIndex = (asset: string) =>
  asset === 'USDC' ? 0 : stockIndex(asset) + 1;
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
/**
 * Every stock's price at the book's date, in book order: the attested live
 * marks a live book carries (0 for a stock none has been attested for), or
 * the stored close on the replay.
 */
const spots = (b: VaultBook) =>
  cat(
    ...UNDERLYINGS.map((u) =>
      amount(b.spots ? (b.spots[u.symbol] ?? 0) : storedMark(u.symbol, b.date)),
    ),
  );
/** The clock a live action carries, as `Option<Tick>`. */
export const tick = (t: PlanTick | undefined) =>
  t
    ? cat(
        byte(1),
        date(t.date),
        vec(UNDERLYINGS, (u) => amount(t.spots[u.symbol] ?? 0)),
        vec(
          Object.entries(t.closes).sort(([a], [b]) => a.localeCompare(b)),
          ([key, price]) => {
            const [at, symbol] = key.split('|');
            return cat(date(at), stock(symbol), amount(price));
          },
        ),
        amount(t.apr ?? 0),
        byte(t.carry),
      )
    : byte(0);
export const terms = (t: OrderTerms) =>
  cat(
    stock(t.symbol),
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
    spots(b),
    byte(b.margin === 'isolated'),
    ...[b.wallet, b.vault, b.counterparty, b.market].map((a) =>
      cat(amount(a.USDC), ...UNDERLYINGS.map((u) => amount(a[u.symbol] ?? 0))),
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
          stock(p.symbol),
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
          stock(p.symbol),
          amount(p.quantity),
          date(p.opened),
          date(p.expiry),
          amount(p.cap),
          amount(p.maxInterest),
        ),
    ),
    vec(
      b.borrows.filter((p) => p.status === 'active'),
      (p) =>
        cat(
          id(p.id),
          stock(p.symbol),
          amount(p.pledged),
          amount(p.principal),
          amount(p.apr),
          byte(p.rate === 'fixed'),
          date(p.opened),
          p.rate === 'fixed' && p.expiry ? date(p.expiry) : zero,
          amount(p.accrued),
          date(p.accruedTo),
        ),
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
 * The asset an action moves between the test wallet and the vault, whose
 * token accounts the transaction carries. Everything else settles inside
 * the vault's escrow and moves nothing, so cash stands in.
 */
export function movedAsset(p: VaultPlan) {
  return p.action.type === 'transfer' ? String(p.action.asset) : 'USDC';
}
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
        byte(assetIndex(String(a.asset))),
        amount(a.amount as number),
      );
    case 'stock':
      if (p.fill === undefined) throw Error('A stock order needs its fill.');
      return cat(
        byte(1),
        stock(String(a.symbol ?? DEFAULT_UNDERLYING)),
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
      return cat(
        byte(5),
        id(l.id),
        stock(l.symbol),
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
        stock(s.symbol),
        amount(s.quantity),
        amount(s.cap),
        date(s.expiry),
        amount(s.premium),
      );
    }
    case 'close-short':
      return cat(byte(8), id(a.id as string));
    case 'advance': {
      // A replay advance: every stock takes its committed close.
      const at = a.date as string;
      return cat(
        byte(9),
        tick({
          date: at,
          spots: Object.fromEntries(
            UNDERLYINGS.map((u) => [u.symbol, storedMark(u.symbol, at)]),
          ),
          closes: {},
          apr: repriced(p),
          carry: true,
        }).subarray(1),
      );
    }
    case 'restart':
      return byte(10);
    case 'borrow': {
      const opened = b.borrows.find(
        (o) => !p.before.borrows.some((old) => old.id === o.id),
      );
      if (!opened) throw Error('No cash borrow in prepared plan.');
      return cat(
        byte(11),
        id(opened.id),
        stock(opened.symbol),
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
