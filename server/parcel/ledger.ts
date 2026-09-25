import { randomUUID } from 'node:crypto';
import { units } from '../../lib/engine';
import {
  DIVIDEND,
  DIVIDEND_DATE,
  clockDates,
  expiries,
  liveMarket,
  mark,
  volatility,
} from '../../lib/parcel/market';
import { DEFAULT_UNDERLYING, UNDERLYINGS } from '../../lib/parcel/universe';
import {
  add,
  days,
  deliveries,
  mul,
  orderGreeks,
  round,
} from '../../lib/parcel/math';
import {
  accruedInterest,
  borrowDebt,
  termInterest,
  shortCloseAmounts,
} from '../../lib/parcel/funding';
import {
  borrowRate,
  crossBorrowCap,
  health,
  reserveOf,
} from '../../lib/parcel/lending';
import { clampExecutablePremium, payoffBounds } from '../../lib/parcel/envelope';
import { assertCollateral, risk } from '../../lib/parcel/risk';
import { spreadCost } from '../../lib/parcel/spread';
import { templateTerms } from '../../lib/parcel/templates';
import type {
  Asset,
  Balances,
  BorrowPosition,
  LendingPosition,
  OrderTerms,
  ShortPosition,
  VaultBook,
} from '../../lib/parcel/types';
/**
 * What the test wallet, counterparty and market hold of each underlying.
 *
 * The wallet is a faucet: 25 NVDA and a handful of every token, so a
 * reader can deposit and write on any of them. The counterparty and
 * the market are deep in all of them, so a contract never fails for
 * want of the other side's inventory.
 */
const WALLET_SEED: Record<string, number> = { NVDA: 25 };
const TOKEN_SEED = 5;
const OTHER_SIDE = 10000;
const balances = (cash: number, of: (symbol: string) => number): Balances =>
  Object.fromEntries([
    ['USDC', cash],
    ...UNDERLYINGS.map((u) => [u.symbol, of(u.symbol)]),
  ]);
export function initialVault(): VaultBook {
  const live = !!liveMarket();
  return {
    version: 3,
    ...(live ? { clock: 'live' as const } : {}),
    date: live ? new Date().toISOString() : '2025-01-24',
    margin: 'cross',
    wallet: balances(10000, (s) => WALLET_SEED[s] ?? TOKEN_SEED),
    vault: balances(0, () => 0),
    counterparty: balances(2000000, () => OTHER_SIDE),
    market: balances(2000000, () => OTHER_SIDE),
    options: [],
    loans: [],
    shorts: [],
    borrows: [],
    events: [],
  };
}
/**
 * Bring a stored book up to the current shape.
 *
 * A version 2 book knew one underlying, so everything in it is NVDA:
 * its positions gain that symbol and its balances gain a zero, or the
 * seed, for every underlying that has arrived since. Conservation
 * holds because the seeds land on the wallet, counterparty and market
 * together, the way a fresh book starts.
 */
export function migrate(book: VaultBook & { version: number }): VaultBook {
  // Cash loans arrived after version 3 without changing anything a
  // stored book already had, so an older book just gains the empty list.
  book.borrows ??= [];
  if (book.version >= 3) return book;
  const fresh = initialVault();
  for (const side of ['wallet', 'vault', 'counterparty', 'market'] as const)
    for (const u of UNDERLYINGS)
      book[side][u.symbol] ??= side === 'vault' ? 0 : fresh[side][u.symbol];
  for (const p of book.options) p.terms.symbol ??= DEFAULT_UNDERLYING;
  for (const p of book.loans) p.symbol ??= DEFAULT_UNDERLYING;
  for (const p of book.shorts) p.symbol ??= DEFAULT_UNDERLYING;
  for (const e of book.events) e.symbol ??= DEFAULT_UNDERLYING;
  book.version = 3;
  return book;
}
/**
 * The same vault with a position in it, for demonstrating the desk.
 *
 * Built by running deposits, loans, shorts, borrows and contracts through
 * the ordinary ledger functions rather than by writing rows into the
 * books. That matters: a hand-written row looks identical until someone
 * presses Recall, at which point the balances it was never part of refuse
 * to move. Seeded this way the health factor, the reserved share count,
 * the activity feed and every close button agree with each other.
 *
 * Off unless PARCEL_DEMO is set, so the test suite keeps the empty
 * vault every one of its assertions is written against.
 */
export function demoVault(): VaultBook {
  const book = initialVault();
  // Demo needs a deeper wallet than the empty-book faucet: cash for
  // option premia and borrows, and enough of each pre-IPO token to hold
  // and lend without draining the counterparty seed.
  book.wallet.USDC = add(book.wallet.USDC, 40_000);
  for (const symbol of [
    'SPACEX',
    'ANTHROPIC',
    'OPENAI',
    'ANDURIL',
    'NEURALINK',
  ] as const)
    book.wallet[symbol] = add(book.wallet[symbol] ?? 0, 10);

  const expiry = expiries(book.date).find(
    (d) => days(book.date, d) >= 14,
  ) as string;
  if (!expiry) throw Error('Demo vault needs an expiry at least two weeks out.');

  const deposit = (asset: Asset, amount: number) => {
    transfer(book.wallet, book.vault, asset, amount);
    emit(
      book,
      'Vault deposit',
      `${amount} ${asset} deposited from test wallet`,
      asset === 'USDC' ? amount : 0,
      asset === 'USDC' ? 0 : amount,
      undefined,
      asset === 'USDC' ? DEFAULT_UNDERLYING : asset,
    );
  };

  deposit('USDC', 25_000);
  deposit('NVDA', 25);
  deposit('SPACEX', 8);
  deposit('ANTHROPIC', 4);
  deposit('OPENAI', 3);
  deposit('ANDURIL', 5);
  deposit('NEURALINK', 3);

  const write = (id: string, symbol: string, quantity: number) => {
    const price = mark(symbol, book.date);
    const terms = templateTerms(id, expiry, symbol, price);
    terms.quantity = quantity;
    // Seed at the same traded premium a live open would charge so demo
    // positions never sit at a silent mid while the desk shows an ask.
    addOrder(book, terms, tradedPremium(terms, book));
  };

  // Options across the book: covered call on NVDA, directional and
  // defined-risk tickets on the pre-IPO sleeve.
  write('covered-call', 'NVDA', 2);
  write('call', 'OPENAI', 0.5);
  write('put', 'ANTHROPIC', 0.5);
  write('call-spread', 'SPACEX', 1);
  write('put-spread', 'ANDURIL', 1);

  openLoan(book, 4, expiry, 'NVDA');
  openLoan(book, 2, expiry, 'SPACEX');

  openShort(
    book,
    2,
    round(mark('NVDA', book.date) * 1.12),
    expiry,
    'NVDA',
  );
  openShort(
    book,
    1,
    round(mark('ANDURIL', book.date) * 1.15),
    expiry,
    'ANDURIL',
  );

  // Cash borrow against free NVDA so the positions table shows USDC debt
  // and Activity records the draw.
  const freeNvda = risk(book).freeShares.NVDA ?? 0;
  const pledge = Math.min(3, Math.floor(freeNvda * 1e6) / 1e6);
  if (pledge > 0) {
    const price = mark('NVDA', book.date);
    const apr = borrowRate('NVDA', null);
    const amount =
      Math.floor(pledge * price * (reserveOf('NVDA')?.ltv ?? 0.6) * 0.45 * 1e6) /
      1e6;
    if (amount >= 1)
      openBorrow(book, pledge, amount, 'variable', apr, undefined, 'NVDA');
  }

  return book;
}

/** The book a new session starts on. */
export function seedVault(): VaultBook {
  return process.env.PARCEL_DEMO ? demoVault() : initialVault();
}

export function transfer(
  from: Balances,
  to: Balances,
  asset: Asset,
  amount: number,
) {
  units(amount);
  if (amount > (from[asset] ?? 0))
    throw Error(`Insufficient ${asset} balance.`);
  from[asset] = add(from[asset] ?? 0, -amount);
  to[asset] = add(to[asset] ?? 0, amount);
}
export function signedTransfer(
  from: Balances,
  to: Balances,
  asset: Asset,
  amount: number,
) {
  if (amount >= 0) transfer(from, to, asset, amount);
  else transfer(to, from, asset, -amount);
}
export function emit(
  book: VaultBook,
  title: string,
  detail: string,
  cash = 0,
  shares = 0,
  reference?: string,
  symbol = DEFAULT_UNDERLYING,
) {
  book.events.unshift({
    id: randomUUID(),
    date: book.date,
    timestamp: Date.now(),
    title,
    detail,
    cash,
    shares,
    symbol,
    reference,
  });
}
export function premium(terms: OrderTerms, book: VaultBook) {
  const s =
    terms.reference === 'dividend' ? DIVIDEND : mark(terms.symbol, book.date);
  const value = round(
    orderGreeks(
      terms,
      s,
      book.date,
      terms.reference === 'dividend' ? 0.8 : volatility(terms.symbol),
    ).price,
  );
  const bounds = payoffBounds(terms);
  if (bounds.cashMin === 0n && bounds.cashMax === 0n)
    throw Error('This contract has no payable value at settlement precision.');
  return clampExecutablePremium(terms, value);
}

/**
 * The cash amount that opens or closes this contract against the modelled
 * market maker: mid from {@link premium}, plus the live per-leg crossing
 * cost (zero off the live market). Open and close both cross; a long pays
 * the ask to open and receives the bid to close.
 *
 * Open premiums for bounded claims are clamped to the same payoff envelope
 * the Parcel program enforces on `Action::Open`, so a live ask cannot exceed
 * max payable value (or a credit the max loss) and then fail on-chain.
 *
 * Chain indications, funded quotes and durable fills all read this one
 * schedule so the premium on screen is the premium charged.
 */
export function tradedPremium(
  terms: OrderTerms,
  book: VaultBook,
  intent: 'open' | 'close' = 'open',
) {
  const mid = premium(terms, book);
  const crossing =
    terms.reference === 'stock'
      ? spreadCost(
          terms,
          mark(terms.symbol, book.date),
          book.date,
          volatility(terms.symbol),
        )
      : 0;
  const raw = add(intent === 'close' ? -mid : mid, crossing);
  // Close is not envelope-checked on-chain; only Open is.
  return intent === 'open' ? clampExecutablePremium(terms, raw) : raw;
}
export function addOrder(
  book: VaultBook,
  terms: OrderTerms,
  cost: number,
  id = randomUUID(),
) {
  if (book.options.length >= 500)
    throw Error('This account has reached its contract history limit.');
  signedTransfer(book.vault, book.counterparty, 'USDC', cost);
  book.options.unshift({
    id,
    terms: structuredClone(terms),
    premium: cost,
    opened: book.date,
    status: 'active',
  });
  assertCollateral(book);
  emit(
    book,
    'Contract opened',
    `${terms.name} · ${terms.quantity} ${terms.symbol} share-equivalent${terms.quantity === 1 ? '' : 's'} · ${terms.expiry}`,
    -cost,
    0,
    id,
    terms.symbol,
  );
  return id;
}
export function closeOrder(book: VaultBook, id: string, quotedValue?: number) {
  const p = book.options.find((p) => p.id === id && p.status === 'active');
  if (!p) throw Error('This active contract was not found.');
  // Default path must match the live close quote: credit the bid (mid less
  // crossing), never the uncrossed mid. Service execute always passes the
  // reviewed quote; this keeps direct ledger closes honest too.
  const cost = quotedValue ?? -tradedPremium(p.terms, book, 'close');
  signedTransfer(book.counterparty, book.vault, 'USDC', cost);
  p.status = 'closed';
  p.cashFlow = cost;
  p.stockFlow = 0;
  assertCollateral(book);
  emit(book, 'Contract closed', p.terms.name, cost, 0, id, p.terms.symbol);
}
export function setMarketDate(
  book: VaultBook,
  date: string,
  /** The pool's borrow APR for an asset as of this session; variable loans reprice off it. */
  observe?: (symbol: string) => number,
) {
  if (!clockDates.includes(date))
    throw Error('Choose an available market session.');
  if (date <= book.date)
    throw Error('The test market can only advance to a later stored session.');
  book.date = date;
  settleDue(book, date, (expiry) => expiry <= date, observe);
  emit(
    book,
    'Market session advanced',
    `${date} · NVDA $${mark(DEFAULT_UNDERLYING, date).toFixed(2)} historical close`,
  );
  assertCollateral(book);
}

/**
 * Bring a live book up to now.
 *
 * The clock is the wall clock. Anything whose expiry close has been
 * recorded settles at that close, exactly as a replay session would
 * settle it at a stored one; anything whose close is not final yet waits,
 * however late it is. Cash loans book their interest and reprice once a
 * day. Returns whether a position changed, which is when the book has to
 * be written back.
 */
export function syncLive(
  book: VaultBook,
  now: string,
  observe?: (symbol: string) => number,
) {
  const live = liveMarket();
  if (!live) throw Error('The live market is not running.');
  const state = () =>
    [book.options, book.loans, book.shorts, book.borrows]
      .flatMap((list) => list.map((p) => p.status))
      .join();
  const before = state();
  const newDay = book.date.slice(0, 10) !== now.slice(0, 10);
  book.date = now;
  const today = now.slice(0, 10);
  settleDue(
    book,
    now,
    (expiry, symbol) => expiry <= today && live.close(symbol, expiry) != null,
    newDay ? observe : undefined,
    newDay,
  );
  assertCollateral(book);
  return state() !== before;
}

/**
 * Settle every position that is due, the same way on either clock.
 *
 * All positions expiring together clear atomically. Never remove just one
 * hedge from a shared collateral set before settling its offsetting
 * obligations.
 */
function settleDue(
  book: VaultBook,
  date: string,
  due: (expiry: string, symbol: string) => boolean,
  observe?: (symbol: string) => number,
  carry = true,
) {
  const settling = book.options.filter(
    (p) => p.status === 'active' && due(p.terms.expiry, p.terms.symbol),
  );
  // One clearing per underlying and expiry: shares of one token never
  // net against another's, and each settles on its own committed close.
  const byExpiry = new Map<string, typeof settling>();
  for (const p of settling) {
    const key = `${p.terms.expiry}|${p.terms.symbol}`;
    const group = byExpiry.get(key) || [];
    group.push(p);
    byExpiry.set(key, group);
  }
  for (const [key, positions] of [...byExpiry].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [expiry, symbol] = key.split('|');
    let cash = 0,
      shares = 0;
    for (const p of positions) {
      const observation =
        p.terms.reference === 'dividend' ? DIVIDEND : mark(symbol, expiry);
      if (p.terms.reference === 'dividend' && date < DIVIDEND_DATE)
        throw Error('The committed dividend observation is not available yet.');
      const d = deliveries(p.terms, observation);
      cash = add(cash, d.cash);
      shares = add(shares, d.shares);
      p.status = 'settled';
      p.cashFlow = d.cash;
      p.stockFlow = d.shares;
    }
    signedTransfer(book.counterparty, book.vault, 'USDC', cash);
    signedTransfer(book.counterparty, book.vault, symbol, shares);
    emit(
      book,
      'Expiry settled',
      `${positions.length} ${symbol} contract${positions.length === 1 ? '' : 's'} cleared together · ${expiry}`,
      cash,
      shares,
      undefined,
      symbol,
    );
  }
  for (const p of book.shorts.filter(
    (p) => p.status === 'active' && due(p.expiry, p.symbol),
  ))
    closeShort(book, p, p.expiry);
  for (const p of book.loans.filter(
    (p) => p.status === 'active' && due(p.expiry, p.symbol),
  ))
    closeLoan(book, p, p.expiry);
  if (!carry) return;
  for (const p of book.borrows.filter((p) => p.status === 'active'))
    carryBorrow(book, p, date, due, observe);
}
export function openLoan(
  book: VaultBook,
  quantity: number,
  expiry: string,
  symbol = DEFAULT_UNDERLYING,
) {
  if (quantity > risk(book).freeShares[symbol])
    throw Error(
      'Shares already committed to another obligation cannot be lent.',
    );
  const entry = mark(symbol, book.date),
    cap = round(entry * 1.5);
  const protection = premium(
    {
      symbol,
      name: 'Borrower protection',
      quantity,
      expiry,
      reference: 'stock',
      settlement: 'physical',
      legs: [{ kind: 'call', side: 'buy', strike: cap, ratio: 1 }],
    },
    book,
  );
  const collateral = mul(quantity, cap),
    apr = 0.035;
  const prepaidInterest = termInterest(quantity, entry, book.date, expiry);
  const total = add(collateral, prepaidInterest);
  if (book.counterparty.USDC - total < risk(book).counterpartyCash)
    throw Error('Borrower collateral is unavailable.');
  transfer(book.vault, book.market, symbol, quantity);
  transfer(book.market, book.counterparty, 'USDC', mul(quantity, entry));
  transfer(book.counterparty, book.market, 'USDC', protection);
  book.counterparty.USDC = add(book.counterparty.USDC, -total);
  const p: LendingPosition = {
    productive: { entry, cap, premium: protection },
    id: randomUUID(),
    symbol,
    quantity,
    opened: book.date,
    expiry,
    collateral,
    prepaidInterest,
    apr,
    status: 'active',
    earned: 0,
  };
  book.loans.unshift(p);
  assertCollateral(book);
  emit(
    book,
    'Stock loan funded',
    `${quantity} ${symbol} sold by borrower · 150% strike protection and full-term interest funded`,
    0,
    -quantity,
    p.id,
    symbol,
  );
}
export function closeLoan(book: VaultBook, p: LendingPosition, at = book.date) {
  if (p.status !== 'active') throw Error('This stock loan is already closed.');
  const earned = accruedInterest(p.prepaidInterest, p.opened, p.expiry, at);
  const spot = mark(p.symbol, at);
  if (p.productive) {
    const repurchase = mul(p.quantity, Math.min(spot, p.productive.cap));
    book.market.USDC = add(book.market.USDC, repurchase);
    transfer(book.market, book.vault, p.symbol, p.quantity);
  } else transfer(book.counterparty, book.vault, p.symbol, p.quantity);
  book.vault.USDC = add(book.vault.USDC, earned);
  book.counterparty.USDC = add(
    book.counterparty.USDC,
    add(
      add(
        p.collateral,
        -(p.productive ? mul(p.quantity, Math.min(spot, p.productive.cap)) : 0),
      ),
      add(p.prepaidInterest, -earned),
    ),
  );
  p.status = 'closed';
  p.earned = earned;
  emit(
    book,
    'Lent shares returned',
    `${p.quantity} ${p.symbol} returned; accrued interest credited`,
    earned,
    p.quantity,
    p.id,
    p.symbol,
  );
}
export function openShort(
  book: VaultBook,
  quantity: number,
  cap: number,
  expiry: string,
  symbol = DEFAULT_UNDERLYING,
) {
  const entry = mark(symbol, book.date);
  if (cap <= entry || cap > entry * 2)
    throw Error(
      'Choose a protective strike above the reference price and at most twice that price.',
    );
  const terms: OrderTerms = {
    symbol,
    name: 'Protective call',
    quantity,
    expiry,
    reference: 'stock',
    settlement: 'physical',
    legs: [{ kind: 'call', side: 'buy', strike: cap, ratio: 1 }],
  };
  const cost = premium(terms, book),
    maxInterest = termInterest(quantity, entry, book.date, expiry);
  // Borrow stock, sell it to the funded test market and buy a covered call.
  // Sale proceeds stay in the vault; the maximum buyback and term interest lock.
  transfer(book.counterparty, book.market, symbol, quantity);
  transfer(book.market, book.vault, 'USDC', mul(quantity, entry));
  transfer(book.vault, book.counterparty, 'USDC', cost);
  const p: ShortPosition = {
    id: randomUUID(),
    symbol,
    quantity,
    entry,
    cap,
    premium: cost,
    opened: book.date,
    expiry,
    maxInterest,
    status: 'active',
  };
  book.shorts.unshift(p);
  assertCollateral(book);
  emit(
    book,
    'Protected short opened',
    `${quantity} ${symbol} sold · ${cap} protective call · maximum repayment funded`,
    add(mul(quantity, entry), -cost),
    0,
    p.id,
    symbol,
  );
}
export function closeShort(book: VaultBook, p: ShortPosition, at = book.date) {
  if (p.status !== 'active') throw Error('This short is already closed.');
  const spot = mark(p.symbol, at),
    { repurchase: cost, interest, pnl } = shortCloseAmounts(p, spot, at);
  if (spot > p.cap) {
    // Call exercise supplies the shares used to repay the same borrow: the
    // counterparty delivers then receives them atomically, so no net stock move.
    transfer(book.vault, book.counterparty, 'USDC', cost);
  } else {
    transfer(book.vault, book.market, 'USDC', cost);
    transfer(book.market, book.counterparty, p.symbol, p.quantity);
  }
  transfer(book.vault, book.counterparty, 'USDC', interest);
  p.status = 'closed';
  p.pnl = pnl;
  emit(
    book,
    'Protected short closed',
    `${p.quantity} ${p.symbol} borrow repaid · protective call retired`,
    -add(cost, interest),
    0,
    p.id,
    p.symbol,
  );
}
/**
 * A cash loan against stock left in the vault.
 *
 * The pool lends the cash; the pledge stays in the vault and is
 * reserved. A fixed loan locks the rate the pool quotes now and repays
 * itself on its last session; a variable loan is repriced every
 * session off the same curve and runs until it is repaid. Either kind
 * is sold up if the pledge stops covering the debt at the asset's
 * liquidation threshold.
 */
export function openBorrow(
  book: VaultBook,
  pledged: number,
  amount: number,
  rate: BorrowPosition['rate'],
  apr: number,
  expiry: string | undefined,
  symbol = DEFAULT_UNDERLYING,
) {
  const reserve = reserveOf(symbol);
  if (!reserve) throw Error('Choose a supported underlying.');
  if (rate === 'fixed' && !expiry)
    throw Error('A fixed-rate loan needs a session to end on.');
  if (pledged > risk(book).freeShares[symbol])
    throw Error(
      'Shares already committed to another obligation cannot be pledged.',
    );
  const price = mark(symbol, book.date),
    pledgeLimit = Math.floor(pledged * price * reserve.ltv * 1e6) / 1e6;
  // Cross-margin: every vault holding already counts toward borrow power,
  // so a new draw cannot exceed what health() says is still free — on top
  // of the isolated pledge LTV (PRODUCT: pledges never net).
  const collateral = [
    { symbol: 'USDC', amount: book.vault.USDC, price: 1 },
    ...UNDERLYINGS.map((u) => ({
      symbol: u.symbol,
      amount: book.vault[u.symbol] ?? 0,
      price: mark(u.symbol, book.date),
    })),
  ].filter((h) => h.amount > 0);
  const debt: { symbol: string; amount: number; price: number }[] = [];
  const shorted: Record<string, number> = {};
  for (const p of book.shorts.filter((p) => p.status === 'active'))
    shorted[p.symbol] = (shorted[p.symbol] ?? 0) + p.quantity;
  for (const [of, qty] of Object.entries(shorted))
    debt.push({ symbol: of, amount: qty, price: mark(of, book.date) });
  for (const p of book.borrows.filter((p) => p.status === 'active'))
    debt.push({
      symbol: 'USDC',
      amount: borrowDebt(p, book.date).total,
      price: 1,
    });
  const power = health(collateral, debt).available;
  const limit = crossBorrowCap(pledgeLimit, power);
  if (amount > limit)
    throw Error(
      limit < pledgeLimit
        ? `Cross-margin borrow power is ${limit.toFixed(2)} USDC after existing debt.`
        : `${symbol} lends up to ${Math.round(reserve.ltv * 100)}% of its value: at most ${limit.toFixed(2)} USDC against this pledge.`,
    );
  transfer(book.market, book.vault, 'USDC', amount);
  const p: BorrowPosition = {
    id: randomUUID(),
    symbol,
    pledged,
    principal: amount,
    rate,
    apr,
    opened: book.date,
    ...(rate === 'fixed' ? { expiry } : {}),
    accrued: 0,
    accruedTo: book.date,
    status: 'active',
  };
  book.borrows.unshift(p);
  assertCollateral(book);
  emit(
    book,
    'Cash borrowed',
    `${amount} USDC drawn against ${pledged} ${symbol} · ${(apr * 100).toFixed(2)}% ${rate}${expiry ? ` until ${expiry}` : ''}`,
    amount,
    0,
    p.id,
    symbol,
  );
}
/** Book the interest run since the last session, capped at a fixed loan's end. */
function accrueBorrow(p: BorrowPosition, at: string) {
  const { interest } = borrowDebt(p, at);
  p.accrued = interest;
  p.accruedTo = p.expiry && p.expiry < at ? p.expiry : at;
}
/**
 * Settle a cash loan.
 *
 * Repaid: the vault pays principal and interest back to the pool, and
 * the pledge is released. Expired: the same, from the vault's cash if
 * it is there, otherwise the pledge is sold to the pool at the closing
 * mark and the debt is taken from the proceeds. Liquidated: the pledge
 * is sold and the pool also takes its bonus. A vault with less than
 * the debt after the sale leaves the shortfall with the pool; the
 * transfers still balance because nothing is created.
 */
export function repayBorrow(
  book: VaultBook,
  p: BorrowPosition,
  at = book.date,
  how: NonNullable<BorrowPosition['closedBy']> = 'repaid',
) {
  if (p.status !== 'active') throw Error('This loan is already repaid.');
  accrueBorrow(p, at);
  const debt = add(p.principal, p.accrued);
  let sold = 0,
    proceeds = 0,
    bonus = 0,
    taken = debt;
  if (how === 'repaid' || (how === 'expired' && book.vault.USDC >= debt)) {
    transfer(book.vault, book.market, 'USDC', debt);
  } else {
    const spot = mark(p.symbol, at);
    sold = p.pledged;
    proceeds = mul(p.pledged, spot);
    transfer(book.vault, book.market, p.symbol, sold);
    transfer(book.market, book.vault, 'USDC', proceeds);
    bonus = how === 'liquidated' ? mul(debt, reserveOf(p.symbol)!.bonus) : 0;
    taken = Math.min(add(debt, bonus), book.vault.USDC);
    transfer(book.vault, book.market, 'USDC', taken);
  }
  p.status = 'closed';
  p.paid = p.accrued;
  p.closedBy = how;
  emit(
    book,
    how === 'repaid'
      ? 'Cash loan repaid'
      : how === 'expired'
        ? 'Cash loan settled at term'
        : 'Cash loan liquidated',
    sold
      ? `${sold} ${p.symbol} pledge sold at $${mark(p.symbol, at)} · ${debt} USDC debt${bonus ? ` and ${bonus} USDC liquidation bonus` : ''} taken from the proceeds`
      : `${p.principal} USDC principal and ${p.accrued} USDC interest returned to the pool · ${p.pledged} ${p.symbol} released`,
    add(proceeds, -taken),
    -sold,
    p.id,
    p.symbol,
  );
}
/**
 * One session's work on an open cash loan: a fixed loan that has run
 * its term settles at its own close; anything else books the interest
 * since last session at the rate that was in force, a variable loan
 * takes the pool's new rate, and a pledge that no longer covers the
 * debt at the liquidation threshold is sold up at this session's mark.
 */
function carryBorrow(
  book: VaultBook,
  p: BorrowPosition,
  date: string,
  due: (expiry: string, symbol: string) => boolean,
  observe?: (symbol: string) => number,
) {
  if (p.expiry && due(p.expiry, p.symbol)) {
    repayBorrow(book, p, p.expiry, 'expired');
    return;
  }
  // A fixed loan past its date but before its close is final keeps
  // running at its fixed rate until the close is in.
  if (p.expiry && p.expiry <= date) return;
  accrueBorrow(p, date);
  if (p.rate === 'variable' && observe) p.apr = observe(p.symbol);
  const cover =
    mul(p.pledged, mark(p.symbol, date)) * reserveOf(p.symbol)!.liquidation;
  if (add(p.principal, p.accrued) > cover)
    repayBorrow(book, p, date, 'liquidated');
}
export function totals(book: VaultBook) {
  const balances = [book.wallet, book.vault, book.counterparty, book.market];
  let cash = balances.reduce((s, b) => s + units(b.USDC), 0n);
  for (const p of book.loans.filter((p) => p.status === 'active'))
    cash += units(p.collateral) + units(p.prepaidInterest);
  const shares: Record<string, bigint> = {};
  for (const u of UNDERLYINGS)
    shares[u.symbol] = balances.reduce(
      (s, b) => s + units(b[u.symbol] ?? 0),
      0n,
    );
  return { cash, shares };
}
export function validateLedger(
  book: VaultBook,
  original: ReturnType<typeof totals>,
) {
  for (const balance of [
    book.wallet,
    book.vault,
    book.counterparty,
    book.market,
  ]) {
    units(balance.USDC);
    for (const u of UNDERLYINGS) units(balance[u.symbol] ?? 0);
  }
  const current = totals(book);
  if (
    current.cash !== original.cash ||
    UNDERLYINGS.some(
      (u) => current.shares[u.symbol] !== original.shares[u.symbol],
    )
  )
    throw Error('Asset conservation failed; transaction rolled back.');
  assertCollateral(book);
}
