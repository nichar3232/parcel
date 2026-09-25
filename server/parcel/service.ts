import { optionsChain, sizeOrder } from './catalog';
import { randomUUID } from 'node:crypto';
import {
  DIVIDEND,
  DIVIDEND_DATE,
  mark,
  clockDates,
  expiries,
  liveMarket,
  VOLATILITY,
  volatility,
} from '../../lib/parcel/market';
import {
  DEFAULT_UNDERLYING,
  UNDERLYINGS,
  isUnderlying,
} from '../../lib/parcel/universe';
import { add, mul, orderGreeks } from '../../lib/parcel/math';
import {
  amount as parseAmount,
  expiry,
  parseOrderTerms,
  symbol as parseSymbol,
} from '../../lib/parcel/validation';
import { risk } from '../../lib/parcel/risk';
import { borrowRate } from '../../lib/parcel/lending';
import type {
  Asset,
  Quote,
  VaultBook,
  VaultSnapshot,
} from '../../lib/parcel/types';
import { Store, digest, type Session } from '../db/store';
import { ApiError, object } from '../http/errors';
import { parseKey } from '../domain/portfolio';
import {
  addOrder,
  closeLoan,
  closeOrder,
  closeShort,
  openBorrow,
  repayBorrow,
  emit,
  initialVault,
  chainGenesis,
  migrate,
  seedVault,
  openLoan,
  openShort,
  tradedPremium,
  setMarketDate,
  syncLive,
  type LiveTick,
  totals,
  transfer,
  validateLedger,
} from './ledger';
/** The live clock an onchain action carries: where the book moved to first. */
export interface PlanTick extends LiveTick {
  date: string;
  /** Each underlying's attested mark at `date`; 0 keeps the program's last. */
  spots: Record<string, number>;
}
export interface VaultPlan {
  revision: number;
  before: VaultBook;
  book: VaultBook;
  action: Record<string, unknown>;
  quoteId?: string;
  hash: string;
  /** Set on the live market in chain mode: the sync the action ran after. */
  tick?: PlanTick;
  /** A stock order's fill price. */
  fill?: number;
}
export interface CommitOptions {
  mode?: 'sandbox' | 'localnet' | 'devnet';
  chain?: {
    signature?: string;
    ledger?: string;
    slot?: number;
    network?: string;
  };
}
function mutationEvents(plan: VaultPlan) {
  return plan.book.events.slice(
    0,
    Math.max(0, plan.book.events.length - plan.before.events.length),
  );
}
function executePremium(plan: VaultPlan): number | undefined {
  if (plan.action.type !== 'execute') return undefined;
  const opened = plan.book.options.find(
    (p) => !plan.before.options.some((b) => b.id === p.id),
  );
  if (opened) return opened.premium;
  const closed = plan.book.options.find(
    (p) =>
      p.status !== 'active' &&
      plan.before.options.some((b) => b.id === p.id && b.status === 'active'),
  );
  if (closed && closed.cashFlow !== undefined) return -closed.cashFlow;
  const event = mutationEvents(plan).find(
    (e) => e.title === 'Contract opened' || e.title === 'Contract closed',
  );
  return event ? -event.cash : undefined;
}
export class VaultService {
  constructor(
    private store: Store,
    private clock = Date.now,
    private activeLimit = 500,
    /**
     * How much of an asset's pool is out, as the live engine sees it,
     * or null when nothing is watching. Read once at open for a fixed
     * loan and once a session for a variable one; the rate it yields
     * is stored on the position, so the ledger replays without it.
     */
    private utilisation: (symbol: string) => number | null = () => null,
    /**
     * The book is the onchain program's: nothing is written here that the
     * chain has not executed. Live, a read projects the book to the wall
     * clock without saving it, and the next action carries that clock.
     */
    private chain = false,
  ) {}
  private borrowRate(symbol: string) {
    return borrowRate(symbol, this.utilisation(symbol));
  }
  /** An onchain vault opened on the 2025 replay, which the live market cannot open. */
  replayBookOnLive(sessionId: string): boolean {
    if (!this.chain || !liveMarket()) return false;
    const row = this.store.db
      .prepare('SELECT book FROM vault_accounts WHERE owner=?')
      .get(sessionId) as { book: string } | undefined;
    return !!row && migrate(JSON.parse(row.book)).clock !== 'live';
  }
  private read(session: Session): {
    revision: number;
    book: VaultBook;
    /** Chain mode on the live market: the book as the program holds it. */
    stored?: VaultBook;
    tick?: PlanTick;
  } {
    const onchainLive = this.chain && !!liveMarket();
    this.store.db
      .prepare('INSERT OR IGNORE INTO vault_accounts VALUES(?,0,?,?)')
      .run(
        session.id,
        JSON.stringify(onchainLive ? chainGenesis() : seedVault()),
        this.clock(),
      );
    const row = this.store.db
      .prepare('SELECT revision,book FROM vault_accounts WHERE owner=?')
      .get(session.id) as { revision: number; book: string };
    let revision = row.revision,
      book = migrate(JSON.parse(row.book));
    if (!liveMarket()) return { revision, book };
    if (onchainLive) return this.project(revision, book);
    const save = (
      next: VaultBook,
      actionType: string,
      detail: Record<string, unknown>,
    ) => {
      const result = this.store.db
        .prepare(
          'UPDATE vault_accounts SET revision=?,book=?,updated_at=? WHERE owner=? AND revision=?',
        )
        .run(
          revision + 1,
          JSON.stringify(next),
          this.clock(),
          session.id,
          revision,
        );
      if (result.changes !== 1)
        throw new ApiError(
          409,
          'STALE_REVISION',
          'Your vault changed. Refresh and review the current balances.',
        );
      const key = `system:${actionType}:${revision}->${revision + 1}`;
      this.store.saveMutation({
        owner: session.id,
        key,
        request_hash: digest(`vault-system:${key}`),
        revision_before: revision,
        revision_after: revision + 1,
        action_type: actionType,
        detail,
        mode: 'system',
        created_at: this.clock(),
      });
      this.store.audit(
        session.id,
        'vault',
        JSON.stringify({
          type: actionType,
          revision: revision + 1,
          system: true,
        }),
      );
      revision += 1;
      book = next;
    };
    // A book written on the 2025 replay holds 2025 expiries that will
    // never have a live close. It starts over on the live market.
    if (book.clock !== 'live') {
      save(seedVault(), 'live-market-reset', {
        reason: 'Replay book replaced for live market clock',
      });
    }
    const now = new Date(this.clock()).toISOString();
    const synced = structuredClone(book);
    try {
      const settled = syncLive(synced, now, (symbol) =>
        this.borrowRate(symbol),
      );
      if (settled) {
        const events = synced.events.slice(
          0,
          Math.max(0, synced.events.length - book.events.length),
        );
        save(synced, 'live-settlement', {
          date: now,
          events: events.map((e) => ({
            id: e.id,
            title: e.title,
            detail: e.detail,
            cash: e.cash,
            shares: e.shares,
            symbol: e.symbol,
            reference: e.reference,
          })),
        });
      } else book = synced;
    } catch {
      // A settlement that cannot run yet (no mark, a close not final)
      // leaves the positions as they were; the next read tries again.
      book.date = now;
    }
    return { revision, book };
  }
  /**
   * A chain-mode live read: the stored book is the program's, and stays as
   * it is. The view is that book synced to now; the tick records what the
   * sync saw so the next action can hand the program the same clock.
   */
  private project(revision: number, stored: VaultBook) {
    if (stored.clock !== 'live')
      throw new ApiError(
        409,
        'CHAIN_REPLAY_BOOK',
        'This onchain vault was opened on the 2025 replay and cannot move to the live market. Start a new session.',
      );
    const now = new Date(this.clock()).toISOString();
    const book = structuredClone(stored);
    const record: LiveTick = { carry: false, closes: {} };
    try {
      syncLive(book, now, (symbol) => this.borrowRate(symbol), record);
      // The marks the program is handed: every underlying priced now, and
      // the last attested mark for one that is not, as the program keeps it.
      const live = liveMarket()!;
      const spots = Object.fromEntries(
        UNDERLYINGS.map((u) => [
          u.symbol,
          live.spot(u.symbol) ?? stored.spots?.[u.symbol] ?? 0,
        ]),
      );
      book.spots = spots;
      return {
        revision,
        book,
        stored,
        tick: { ...record, date: now, spots },
      };
    } catch {
      // No mark yet: the view waits on the stored book, and an action is
      // refused until there is a price to attest.
      const view = structuredClone(stored);
      view.date = now;
      return { revision, book: view, stored };
    }
  }
  snapshot(session: Session): VaultSnapshot {
    const { revision, book } = liveMarket()
      ? this.store.transaction(() => this.read(session))
      : this.read(session);
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
        dates: liveMarket() ? expiries(book.date) : clockDates,
        clock: liveMarket() ? 'live' : 'daily-close-with-hourly-test-clock',
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
  /**
   * Mutation receipts are intentionally durable for idempotency. Complete a
   * receipt from an older UI schema with the current market metadata before
   * returning it; the recorded book and revision remain untouched.
   */
  private completeReceipt(session: Session, receipt: VaultSnapshot) {
    if (
      Array.isArray(receipt.market?.underlyings) &&
      receipt.market.underlyings.length
    )
      return receipt;
    return {
      ...receipt,
      market: {
        ...receipt.market,
        underlyings: this.snapshot(session).market.underlyings,
      },
    };
  }
  private capacity(book: VaultBook) {
    const active = [
      ...book.options,
      ...book.loans,
      ...book.shorts,
      ...book.borrows,
    ].filter((p) => p.status === 'active').length;
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
      // Opening pays the ask (or, writing, receives the bid); closing
      // crosses back the other way. Off the live market the spread is 0.
      // Chain indications use the same tradedPremium helper.
      const cost = tradedPremium(
        parsed,
        current.book,
        closing ? 'close' : 'open',
      );
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
    const { revision, book, stored, tick } = this.read(session);
    this.revision(request, revision);
    if (stored && !tick)
      throw Error(
        `No live ${DEFAULT_UNDERLYING} price yet, so the onchain action was not prepared. Try again in a moment.`,
      );
    // Chain mode on the live market: `before` is the program's book and the
    // action applies to it synced to now, the way the program will run it.
    const before = structuredClone(stored ?? book);
    let quoteId: string | undefined, fill: number | undefined;
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
        live = liveMarket(),
        // A buyer pays the ask and a seller receives the bid. On a live
        // session a fresh quote is required: a stale or oracle mark never
        // fills. Displayed size bounds the order only where the feed
        // publishes one. The stored replay trades at its committed close.
        side = live?.quote?.(on),
        quantity = parseAmount(a.quantity),
        price = live
          ? (() => {
              if (!side)
                throw Error(
                  `No fresh ${on} bid/ask is available right now, so the stock order was not placed.`,
                );
              const displayed = a.side === 'buy' ? side.askSize : side.bidSize;
              if (
                displayed !== undefined &&
                (!Number.isFinite(displayed) || displayed <= 0)
              )
                throw Error(
                  `The fresh consolidated ${a.side === 'buy' ? 'ask' : 'bid'} for ${on} has no displayed size.`,
                );
              if (quantity > displayed! + 1e-9)
                throw Error(
                  `${Number(quantity.toFixed(6))} ${on} exceeds the current displayed ${a.side === 'buy' ? 'ask' : 'bid'} size of ${Number(displayed!.toFixed(6))}. Reduce the order or wait for depth to refresh.`,
                );
              return (
                Math.round((a.side === 'buy' ? side.ask : side.bid) * 1e6) / 1e6
              );
            })()
          : mark(on, book.date),
        cash = mul(quantity, price);
      fill = price;
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
    } else if (a.type === 'borrow') {
      if (a.rate !== 'variable' && a.rate !== 'fixed')
        throw Error('Choose a variable or fixed rate.');
      const on = parseSymbol(a.symbol);
      openBorrow(
        book,
        parseAmount(a.pledged),
        parseAmount(a.amount, 0.000001, 1000000),
        a.rate,
        this.borrowRate(on),
        a.rate === 'fixed' ? expiry(a.expiry, book.date) : undefined,
        on,
      );
    } else if (a.type === 'repay') {
      const p = book.borrows.find(
        (p) => p.id === a.id && p.status === 'active',
      );
      if (!p) throw Error('This active loan was not found.');
      repayBorrow(book, p);
    } else if (a.type === 'restart') {
      if (
        book.options.some((p) => p.status === 'active') ||
        book.loans.some((p) => p.status === 'active') ||
        book.shorts.some((p) => p.status === 'active') ||
        book.borrows.some((p) => p.status === 'active')
      )
        throw Error(
          'Close or settle all positions before restarting the replay.',
        );
      const events = book.events;
      Object.assign(
        book,
        this.chain && liveMarket() ? chainGenesis() : initialVault(),
      );
      delete book.spots;
      book.events = events;
      emit(
        book,
        'Historical replay restarted',
        'Test allocations restored; previous receipts remain recorded.',
      );
    } else if (a.type === 'advance') {
      if (liveMarket())
        throw Error(
          'The live market keeps its own clock; contracts settle at their expiry close.',
        );
      if (typeof a.date !== 'string') throw Error('Choose a market date.');
      setMarketDate(book, a.date, (symbol) => this.borrowRate(symbol));
    } else throw Error('Unsupported vault action.');
    if (book.loans.length + book.shorts.length + book.borrows.length > 500)
      throw Error('Account position limit reached.');
    this.capacity(book);
    validateLedger(book, original);
    if (request.source !== undefined && request.source !== 'agent')
      throw Error('Unsupported request source.');
    // Events the action emitted are unshifted ahead of the ones it started with.
    if (request.source === 'agent')
      for (const e of book.events.slice(
        0,
        book.events.length - before.events.length,
      ))
        e.via = 'agent';

    return {
      revision,
      before,
      book,
      action: a,
      quoteId,
      hash: digest('vault-action:' + JSON.stringify(request)),
      ...(stored ? { tick } : {}),
      ...(fill !== undefined ? { fill } : {}),
    };
  }
  commit(
    session: Session,
    key: string,
    plan: VaultPlan,
    options: CommitOptions = {},
  ): VaultSnapshot {
    const cached = this.store.receipt(session.id, key, plan.hash) as
      | VaultSnapshot
      | undefined;
    if (cached) return this.completeReceipt(session, cached);
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
    const mode = options.mode ?? 'sandbox';
    const premium = executePremium(plan);
    const events = mutationEvents(plan);
    const updated = this.store.db
      .prepare(
        'UPDATE vault_accounts SET revision=?,book=?,updated_at=? WHERE owner=? AND revision=?',
      )
      .run(
        plan.revision + 1,
        JSON.stringify(plan.book),
        this.clock(),
        session.id,
        plan.revision,
      );
    if (updated.changes !== 1)
      throw new ApiError(
        409,
        'STALE_REVISION',
        'Your vault changed. Refresh and review the current balances.',
      );
    const detail = {
      action: plan.action,
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        detail: e.detail,
        cash: e.cash,
        shares: e.shares,
        symbol: e.symbol,
        reference: e.reference,
        via: e.via,
      })),
      chain: options.chain,
    };
    this.store.saveMutation({
      owner: session.id,
      key,
      request_hash: plan.hash,
      revision_before: plan.revision,
      revision_after: plan.revision + 1,
      action_type: String(plan.action.type),
      detail,
      quote_id: plan.quoteId,
      premium: premium ?? null,
      mode,
      created_at: this.clock(),
    });
    this.store.audit(
      session.id,
      'vault',
      JSON.stringify({
        type: plan.action.type,
        revision: plan.revision + 1,
        quoteId: plan.quoteId,
        premium,
        mode,
        events: events.map((e) => e.id),
        chainSignature: options.chain?.signature,
      }),
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
      if (cached) return this.completeReceipt(session, cached);
      return this.commit(session, key, this.plan(session, value));
    });
  }
}
