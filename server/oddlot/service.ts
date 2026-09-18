import { optionsChain, sizeOrder } from './catalog';
import { randomUUID } from 'node:crypto';
import {
  DIVIDEND,
  DIVIDEND_DATE,
  mark,
  clockDates,
  VOLATILITY,
  volatility,
} from '../../lib/oddlot/market';
import {
  DEFAULT_UNDERLYING,
  UNDERLYINGS,
  isUnderlying,
} from '../../lib/oddlot/universe';
import { add, mul, orderGreeks } from '../../lib/oddlot/math';
import {
  amount as parseAmount,
  expiry,
  parseOrderTerms,
  symbol as parseSymbol,
} from '../../lib/oddlot/validation';
import { risk } from '../../lib/oddlot/risk';
import type {
  Asset,
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
  migrate,
  seedVault,
  openLoan,
  openShort,
  premium,
  setMarketDate,
  totals,
  transfer,
  validateLedger,
} from './ledger';
export interface VaultPlan {
  revision: number;
  before: VaultBook;
  book: VaultBook;
  action: Record<string, unknown>;
  quoteId?: string;
  hash: string;
}
export class VaultService {
  constructor(
    private store: Store,
    private clock = Date.now,
    private activeLimit = 500,
  ) {}
  private read(session: Session) {
    this.store.db
      .prepare('INSERT OR IGNORE INTO vault_accounts VALUES(?,0,?,?)')
      .run(session.id, JSON.stringify(seedVault()), this.clock());
    const row = this.store.db
      .prepare('SELECT revision,book FROM vault_accounts WHERE owner=?')
      .get(session.id) as { revision: number; book: string };
    return { revision: row.revision, book: migrate(JSON.parse(row.book)) };
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
        symbol: DEFAULT_UNDERLYING,
        price: mark(DEFAULT_UNDERLYING, book.date),
        date: book.date,
        dates: clockDates,
        clock: 'daily-close-with-hourly-test-clock',
        volatility: VOLATILITY,
        dividend: DIVIDEND,
        dividendDate: DIVIDEND_DATE,
        underlyings: UNDERLYINGS.map((u) => ({
          symbol: u.symbol,
          name: u.name,
          provider: u.provider,
          price: mark(u.symbol, book.date),
          volatility: u.volatility,
          simulated: u.simulated,
        })),
      },
    };
  }
  private capacity(book: VaultBook) {
    const active = [...book.options, ...book.loans, ...book.shorts].filter(
      (p) => p.status === 'active',
    ).length;
    if (active > this.activeLimit)
      throw Error(
        `This vault supports ${this.activeLimit} active positions. Close or settle existing positions first.`,
      );
  }
  private revision(request: Record<string, unknown>, current: number) {
    if (!Number.isSafeInteger(request.revision) || request.revision !== current)
      throw new ApiError(
        409,
        'STALE_REVISION',
        'Your vault changed. Refresh and review the current balances.',
      );
  }
  private reject(error: unknown): never {
    if (error instanceof ApiError) throw error;
    if (
      error instanceof Error &&
      'code' in error &&
      String(error.code).startsWith('ERR_SQLITE')
    )
      throw error;
    throw new ApiError(409, 'VAULT_REJECTED', (error as Error).message);
  }
  private transaction<T>(run: () => T): T {
    try {
      return this.store.transaction(run);
    } catch (error) {
      return this.reject(error);
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
      const closing =
        typeof request.positionId === 'string'
          ? current.book.options.find(
              (p) => p.id === request.positionId && p.status === 'active',
            )
          : undefined;
      if (request.positionId !== undefined && !closing)
        throw Error('This active contract was not found.');
      const parsed = closing
        ? closing.terms
        : parseOrderTerms(request.terms, current.book.date);
      const cost = closing
        ? -premium(parsed, current.book)
        : premium(parsed, current.book);
      const projection = structuredClone(current.book);
      projection.vault.USDC = add(projection.vault.USDC, -cost);
      projection.counterparty.USDC = add(projection.counterparty.USDC, cost);
      if (closing)
        projection.options.find((p) => p.id === closing.id)!.status = 'closed';
      else
        projection.options.push({
          id: 'quote-preview',
          terms: parsed,
          premium: cost,
          opened: projection.date,
          status: 'active',
        });
      const after = risk(projection);
      let eligible = true,
        reason: string | undefined;
      try {
        const trial = structuredClone(current.book);
        if (closing) closeOrder(trial, closing.id, -cost);
        else addOrder(trial, parsed, cost);
        this.capacity(trial);
      } catch (e) {
        eligible = false;
        reason = (e as Error).message;
      }
      const quote: Quote = {
        intent: closing ? 'close' : 'open',
        positionId: closing?.id,
        id: randomUUID(),
        revision: current.revision,
        terms: parsed,
        premium: cost,
        issuedAt: this.clock(),
        expiresAt: this.clock() + 30000,
        greeks: orderGreeks(
          parsed,
          parsed.reference === 'dividend'
            ? DIVIDEND
            : mark(parsed.symbol, current.book.date),
          current.book.date,
          parsed.reference === 'dividend' ? 0.8 : volatility(parsed.symbol),
        ),
        cashRequired: after.cash,
        sharesRequired: after.shares[parsed.symbol],
        cashAfter: after.freeCash,
        sharesAfter: after.freeShares[parsed.symbol],
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
  catalog(session: Session, value: unknown, sizing = false) {
    try {
      const request = object(value),
        current = this.read(session);
      this.revision(request, current.revision);
      return {
        revision: current.revision,
        ...(sizing
          ? sizeOrder(current.book, request.terms, request.mode, request.target)
          : optionsChain(
              current.book,
              request.expiry,
              request.quantity,
              parseSymbol(request.symbol),
            )),
      };
    } catch (error) {
      return this.reject(error);
    }
  }
  // The caller owns the SQLite transaction; preparation never sends an RPC.
  plan(session: Session, value: unknown): VaultPlan {
    try {
      return this.planUnchecked(session, value);
    } catch (error) {
      return this.reject(error);
    }
  }
  private planUnchecked(session: Session, value: unknown): VaultPlan {
    const request = object(value),
      a = object(request.action);
    const { revision, book } = this.read(session);
    this.revision(request, revision);
    const before = structuredClone(book);
    let quoteId: string | undefined;
    const original = totals(book);
    if (a.type === 'transfer') {
      if (a.asset !== 'USDC' && !isUnderlying(a.asset))
        throw Error('Choose USDC or a supported underlying.');
      if (a.direction !== 'deposit' && a.direction !== 'withdraw')
        throw Error('Choose deposit or withdraw.');
      const amount = parseAmount(
          a.amount,
          0.000001,
          a.asset === 'USDC' ? 1000000 : 1000,
        ),
        asset: Asset = a.asset;
      if (a.direction === 'deposit')
        transfer(book.wallet, book.vault, asset, amount);
      else transfer(book.vault, book.wallet, asset, amount);
      const signed = a.direction === 'deposit' ? amount : -amount;
      emit(
        book,
        a.direction === 'deposit' ? 'Vault deposit' : 'Vault withdrawal',
        `${amount} ${asset} ${a.direction === 'deposit' ? 'deposited from' : 'returned to'} test wallet`,
        asset === 'USDC' ? signed : 0,
        asset === 'USDC' ? 0 : signed,
        undefined,
        asset === 'USDC' ? DEFAULT_UNDERLYING : asset,
      );
    } else if (a.type === 'stock') {
      if (a.side !== 'buy' && a.side !== 'sell')
        throw Error('Choose buy or sell.');
      const on = parseSymbol(a.symbol),
        price = mark(on, book.date),
        quantity = parseAmount(a.quantity),
        cash = mul(quantity, price);
      if (a.side === 'buy') {
        transfer(book.vault, book.market, 'USDC', cash);
        transfer(book.market, book.vault, on, quantity);
      } else {
        transfer(book.vault, book.market, on, quantity);
        transfer(book.market, book.vault, 'USDC', cash);
      }
      emit(
        book,
        a.side === 'buy' ? 'Stock purchased' : 'Stock sold',
        `${quantity} ${on} at $${price}`,
        a.side === 'buy' ? -cash : cash,
        a.side === 'buy' ? quantity : -quantity,
        undefined,
        on,
      );
    } else if (a.type === 'execute') {
      if (typeof a.quoteId !== 'string') throw Error('Request a quote first.');
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
      if (!q.eligible) throw Error(q.reason || 'This quote is not executable.');
      if (q.intent === 'close' && q.positionId)
        closeOrder(book, q.positionId, -q.premium);
      else addOrder(book, q.terms, q.premium);
      quoteId = q.id;
    } else if (a.type === 'close-option') {
      throw Error(
        'Request and review a close quote before closing this contract.',
      );
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
      openLoan(
        book,
        parseAmount(a.quantity),
        expiry(a.expiry, book.date),
        parseSymbol(a.symbol),
      );
    } else if (a.type === 'recall') {
      const p = book.loans.find((p) => p.id === a.id && p.status === 'active');
      if (!p) throw Error('This active loan was not found.');
      closeLoan(book, p);
    } else if (a.type === 'short') {
      openShort(
        book,
        parseAmount(a.quantity),
        parseAmount(a.cap, 0.000001, 10000),
        expiry(a.expiry, book.date),
        parseSymbol(a.symbol),
      );
    } else if (a.type === 'close-short') {
      const p = book.shorts.find((p) => p.id === a.id && p.status === 'active');
      if (!p) throw Error('This active short was not found.');
      closeShort(book, p);
    } else if (a.type === 'restart') {
      if (
        book.options.some((p) => p.status === 'active') ||
        book.loans.some((p) => p.status === 'active') ||
        book.shorts.some((p) => p.status === 'active')
      )
        throw Error(
          'Close or settle all positions before restarting the replay.',
        );
      const events = book.events;
      Object.assign(book, initialVault());
      book.events = events;
      emit(
        book,
        'Historical replay restarted',
        'Test allocations restored; previous receipts remain recorded.',
      );
    } else if (a.type === 'advance') {
      if (typeof a.date !== 'string') throw Error('Choose a market date.');
      setMarketDate(book, a.date);
    } else throw Error('Unsupported vault action.');
    if (book.loans.length + book.shorts.length > 500)
      throw Error('Account position limit reached.');
    this.capacity(book);
    validateLedger(book, original);

    return {
      revision,
      before,
      book,
      action: a,
      quoteId,
      hash: digest('vault-action:' + JSON.stringify(request)),
    };
  }
  commit(session: Session, key: string, plan: VaultPlan): VaultSnapshot {
    const cached = this.store.receipt(session.id, key, plan.hash) as
      | VaultSnapshot
      | undefined;
    if (cached) return cached;
    const current = this.read(session);
    this.revision({ revision: plan.revision }, current.revision);
    if (plan.quoteId) {
      const result = this.store.db
        .prepare(
          'UPDATE vault_quotes SET consumed=1 WHERE id=? AND owner=? AND consumed=0',
        )
        .run(plan.quoteId, session.id);
      if (result.changes !== 1)
        throw Error('Prepared quote was already consumed.');
    }
    this.store.db
      .prepare(
        'UPDATE vault_accounts SET revision=?,book=?,updated_at=? WHERE owner=?',
      )
      .run(
        plan.revision + 1,
        JSON.stringify(plan.book),
        this.clock(),
        session.id,
      );
    this.store.audit(
      session.id,
      'vault',
      JSON.stringify({ type: plan.action.type, revision: plan.revision + 1 }),
    );
    const result = this.snapshot(session);
    this.store.saveReceipt(session.id, key, plan.hash, result);
    return result;
  }
  apply(session: Session, key: string, value: unknown): VaultSnapshot {
    parseKey(key);
    const hash = digest('vault-action:' + JSON.stringify(object(value)));
    return this.transaction(() => {
      const cached = this.store.receipt(session.id, key, hash) as
        | VaultSnapshot
        | undefined;
      if (cached) return cached;
      return this.commit(session, key, this.plan(session, value));
    });
  }
}
