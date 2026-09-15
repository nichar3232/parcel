import { randomUUID } from 'node:crypto';
import { units } from '../../lib/engine';
import {
  DIVIDEND,
  DIVIDEND_DATE,
  mark,
  marketRows,
  VOLATILITY,
} from '../../lib/oddlot/market';
import { bounded, mul, orderGreeks } from '../../lib/oddlot/math';
import { assertCollateral, risk } from '../../lib/oddlot/risk';
import type {
  Asset,
  Leg,
  OrderTerms,
  Quote,
  VaultBook,
  VaultSnapshot,
} from '../../lib/oddlot/types';
import { Store, digest, type Session } from '../db/store';
import { ApiError, object } from '../http/errors';
import { parseKey } from '../domain/portfolio';
import {
  addOrder,
  closeLoan,
  closeOrder,
  closeShort,
  emit,
  initialVault,
  openLoan,
  openShort,
  premium,
  setMarketDate,
  totals,
  transfer,
  validateLedger,
} from './ledger';
function number(value: unknown, min = 0.000001, max = 1000) {
  if (typeof value !== 'number' || value < min || value > max)
    throw Error(`Enter a number between ${min} and ${max}.`);
  units(value);
  return value;
}
function expiry(value: unknown, date: string) {
  if (
    typeof value !== 'string' ||
    value <= date ||
    !marketRows.some((r) => r.date === value)
  )
    throw Error('Select a future session in the stored market window.');
  return value;
}
function terms(value: unknown, date: string): OrderTerms {
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
      strike: number(l.strike, 0.000001, 10000),
      ratio: number(l.ratio, 1, 4),
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
    quantity: number(t.quantity),
    expiry: end,
    reference: t.reference,
    settlement: t.settlement,
    legs,
  };
}
export class VaultService {
  constructor(
    private store: Store,
    private clock = Date.now,
  ) {}
  private read(session: Session) {
    this.store.db
      .prepare('INSERT OR IGNORE INTO vault_accounts VALUES(?,0,?,?)')
      .run(session.id, JSON.stringify(initialVault()), this.clock());
    const row = this.store.db
      .prepare('SELECT revision,book FROM vault_accounts WHERE owner=?')
      .get(session.id) as { revision: number; book: string };
    return { revision: row.revision, book: JSON.parse(row.book) as VaultBook };
  }
  snapshot(session: Session): VaultSnapshot {
    const { revision, book } = this.read(session);
    return {
      revision,
      book,
      risk: risk(book),
      csrf: session.csrf,
      serverTime: this.clock(),
      mode: 'sandbox',
      market: {
        symbol: 'NVDA',
        price: mark(book.date),
        date: book.date,
        dates: marketRows.map((r) => r.date),
        volatility: VOLATILITY,
        dividend: DIVIDEND,
        dividendDate: DIVIDEND_DATE,
      },
    };
  }
  private revision(request: Record<string, unknown>, current: number) {
    if (!Number.isSafeInteger(request.revision) || request.revision !== current)
      throw new ApiError(
        409,
        'STALE_REVISION',
        'Your vault changed. Refresh and review the current balances.',
      );
  }
  private transaction<T>(run: () => T): T {
    try {
      return this.store.transaction(run);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(409, 'VAULT_REJECTED', (e as Error).message);
    }
  }
  quote(session: Session, key: string, value: unknown): Quote {
    parseKey(key);
    const request = object(value),
      hash = digest('vault-quote:' + JSON.stringify(request));
    return this.transaction(() => {
      const cached = this.store.receipt(session.id, key, hash) as
        | Quote
        | undefined;
      if (cached) return cached;
      const current = this.read(session);
      this.revision(request, current.revision);
      const parsed = terms(request.terms, current.book.date),
        cost = premium(parsed, current.book),
        preview = structuredClone(current.book);
      let eligible = true,
        reason: string | undefined;
      try {
        addOrder(preview, parsed, cost);
      } catch (e) {
        eligible = false;
        reason = (e as Error).message;
      }
      const after = risk(preview);
      const quote: Quote = {
        id: randomUUID(),
        revision: current.revision,
        terms: parsed,
        premium: cost,
        expiresAt: this.clock() + 30000,
        greeks: orderGreeks(
          parsed,
          parsed.reference === 'dividend' ? DIVIDEND : mark(current.book.date),
          current.book.date,
          parsed.reference === 'dividend' ? 0.8 : VOLATILITY,
        ),
        cashRequired: after.cash,
        sharesRequired: after.shares,
        cashAfter: after.freeCash,
        sharesAfter: after.freeShares,
        releasedValue: after.releasedValue,
        eligible,
        reason,
      };
      this.store.db
        .prepare('DELETE FROM vault_quotes WHERE owner=? AND expires_at<?')
        .run(session.id, this.clock() - 86400000);
      this.store.db
        .prepare('INSERT INTO vault_quotes VALUES(?,?,?,?,0)')
        .run(quote.id, session.id, JSON.stringify(quote), quote.expiresAt);
      this.store.saveReceipt(session.id, key, hash, quote);
      return quote;
    });
  }
  apply(session: Session, key: string, value: unknown): VaultSnapshot {
    parseKey(key);
    const request = object(value),
      a = object(request.action),
      hash = digest('vault-action:' + JSON.stringify(request));
    return this.transaction(() => {
      const cached = this.store.receipt(session.id, key, hash) as
        | VaultSnapshot
        | undefined;
      if (cached) return cached;
      const { revision, book } = this.read(session);
      this.revision(request, revision);
      const original = totals(book);
      if (a.type === 'transfer') {
        if (a.asset !== 'USDC' && a.asset !== 'NVDA')
          throw Error('Choose USDC or NVDA.');
        if (a.direction !== 'deposit' && a.direction !== 'withdraw')
          throw Error('Choose deposit or withdraw.');
        const amount = number(
            a.amount,
            0.000001,
            a.asset === 'USDC' ? 1000000 : 1000,
          ),
          asset: Asset = a.asset;
        if (a.direction === 'deposit')
          transfer(book.wallet, book.vault, asset, amount);
        else transfer(book.vault, book.wallet, asset, amount);
        emit(
          book,
          a.direction === 'deposit' ? 'Vault deposit' : 'Vault withdrawal',
          `${amount} ${asset} ${a.direction === 'deposit' ? 'deposited from' : 'returned to'} test wallet`,
          asset === 'USDC' ? (a.direction === 'deposit' ? amount : -amount) : 0,
          asset === 'NVDA' ? (a.direction === 'deposit' ? amount : -amount) : 0,
        );
      } else if (a.type === 'stock') {
        if (a.side !== 'buy' && a.side !== 'sell')
          throw Error('Choose buy or sell.');
        const quantity = number(a.quantity),
          cash = mul(quantity, mark(book.date));
        if (a.side === 'buy') {
          transfer(book.vault, book.market, 'USDC', cash);
          transfer(book.market, book.vault, 'NVDA', quantity);
        } else {
          transfer(book.vault, book.market, 'NVDA', quantity);
          transfer(book.market, book.vault, 'USDC', cash);
        }
        emit(
          book,
          a.side === 'buy' ? 'Stock purchased' : 'Stock sold',
          `${quantity} NVDA at $${mark(book.date)}`,
          a.side === 'buy' ? -cash : cash,
          a.side === 'buy' ? quantity : -quantity,
        );
      } else if (a.type === 'execute') {
        if (typeof a.quoteId !== 'string')
          throw Error('Request a quote first.');
        const row = this.store.db
          .prepare(
            'SELECT state,consumed FROM vault_quotes WHERE id=? AND owner=?',
          )
          .get(a.quoteId, session.id) as
          | { state: string; consumed: number }
          | undefined;
        if (!row) throw Error('This quote does not belong to your session.');
        const q = JSON.parse(row.state) as Quote;
        if (row.consumed) throw Error('This quote was already executed.');
        if (this.clock() >= q.expiresAt)
          throw Error('This quote expired. Refresh the quote.');
        if (q.revision !== revision)
          throw Error(
            'Vault balances changed since this quote. Request a fresh quote.',
          );
        if (!q.eligible)
          throw Error(q.reason || 'This quote is not executable.');
        addOrder(book, q.terms, q.premium);
        this.store.db
          .prepare('UPDATE vault_quotes SET consumed=1 WHERE id=? AND owner=?')
          .run(q.id, session.id);
      } else if (a.type === 'close-option') {
        if (typeof a.id !== 'string') throw Error('Choose a contract.');
        closeOrder(book, a.id);
      } else if (a.type === 'margin') {
        if (a.mode !== 'cross' && a.mode !== 'isolated')
          throw Error('Choose cross or isolated collateral.');
        book.margin = a.mode;
        emit(
          book,
          'Collateral mode changed',
          `${a.mode === 'cross' ? 'Cross' : 'Isolated'} collateral applied to the entire vault`,
        );
      } else if (a.type === 'lend') {
        openLoan(book, number(a.quantity), expiry(a.expiry, book.date));
      } else if (a.type === 'recall') {
        const p = book.loans.find(
          (p) => p.id === a.id && p.status === 'active',
        );
        if (!p) throw Error('This active loan was not found.');
        closeLoan(book, p);
      } else if (a.type === 'short') {
        openShort(
          book,
          number(a.quantity),
          number(a.cap, 0.000001, 10000),
          expiry(a.expiry, book.date),
        );
      } else if (a.type === 'close-short') {
        const p = book.shorts.find(
          (p) => p.id === a.id && p.status === 'active',
        );
        if (!p) throw Error('This active short was not found.');
        closeShort(book, p);
      } else if (a.type === 'advance') {
        if (typeof a.date !== 'string') throw Error('Choose a market date.');
        setMarketDate(book, a.date);
      } else throw Error('Unsupported vault action.');
      if (book.loans.length + book.shorts.length > 500)
        throw Error('Account position limit reached.');
      validateLedger(book, original);
      assertCollateral(book);
      this.store.db
        .prepare(
          'UPDATE vault_accounts SET revision=?,book=?,updated_at=? WHERE owner=?',
        )
        .run(revision + 1, JSON.stringify(book), this.clock(), session.id);
      this.store.audit(
        session.id,
        'vault',
        JSON.stringify({ type: a.type, revision: revision + 1 }),
      );
      const result = this.snapshot(session);
      this.store.saveReceipt(session.id, key, hash, result);
      return result;
    });
  }
}
