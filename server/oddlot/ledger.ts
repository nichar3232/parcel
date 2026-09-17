import { randomUUID } from 'node:crypto';
import { units } from '../../lib/engine';
import {
  DIVIDEND,
  DIVIDEND_DATE,
  expiries,
  mark,
} from '../../lib/oddlot/market';
import {
  add,
  days,
  deliveries,
  mul,
  orderGreeks,
  round,
} from '../../lib/oddlot/math';
import {
  accruedInterest,
  termInterest,
  shortCloseAmounts,
} from '../../lib/oddlot/funding';
import { payoffBounds } from '../../lib/oddlot/envelope';
import { bounded } from '../../lib/oddlot/math';
import { assertCollateral, risk } from '../../lib/oddlot/risk';
import type {
  Asset,
  Balances,
  LendingPosition,
  OrderTerms,
  ShortPosition,
  VaultBook,
} from '../../lib/oddlot/types';
export function initialVault(): VaultBook {
  return {
    version: 2,
    date: '2025-01-24',
    margin: 'cross',
    wallet: { USDC: 10000, NVDA: 25 },
    vault: { USDC: 0, NVDA: 0 },
    counterparty: { USDC: 2000000, NVDA: 10000 },
    market: { USDC: 2000000, NVDA: 10000 },
    options: [],
    loans: [],
    shorts: [],
    events: [],
  };
}
/**
 * The same vault with a position in it, for demonstrating the desk.
 *
 * Built by running the deposits, the loan and the short through the
 * ordinary ledger functions rather than by writing rows into `loans`
 * and `shorts`. That matters: a hand-written row looks identical until
 * someone presses Recall, at which point the balances it was never
 * part of refuse to move. Seeded this way the health factor, the
 * reserved share count, the activity feed and both close buttons all
 * agree with each other, because they are reading a book that actually
 * did the trades.
 *
 * Off unless PARCEL_DEMO is set, so the test suite keeps the empty
 * vault every one of its assertions is written against.
 */
export function demoVault(): VaultBook {
  const book = initialVault();
  const expiry = expiries(book.date).find(
    (d) => days(book.date, d) >= 14,
  ) as string;

  transfer(book.wallet, book.vault, 'USDC', 10_000);
  transfer(book.wallet, book.vault, 'NVDA', 25);

  // Four shares out on loan and two sold short against a $160 cap:
  // enough for both tables to have rows and for the health factor to
  // be a number rather than an infinity.
  openLoan(book, 4, expiry);
  openShort(book, 2, 160, expiry);
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
  if (amount > from[asset]) throw Error(`Insufficient ${asset} balance.`);
  from[asset] = add(from[asset], -amount);
  to[asset] = add(to[asset], amount);
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
) {
  book.events.unshift({
    id: randomUUID(),
    date: book.date,
    timestamp: Date.now(),
    title,
    detail,
    cash,
    shares,
    reference,
  });
}
export function premium(terms: OrderTerms, book: VaultBook) {
  const s = terms.reference === 'dividend' ? DIVIDEND : mark(book.date);
  const value = round(
    orderGreeks(
      terms,
      s,
      book.date,
      terms.reference === 'dividend' ? 0.8 : 0.45,
    ).price,
  );
  const bounds = payoffBounds(terms);
  if (bounds.cashMin === 0n && bounds.cashMax === 0n)
    throw Error('This contract has no payable value at settlement precision.');
  if (!bounded(terms.legs)) return value;
  return Math.max(
    Math.min(0, Number(bounds.cashMin) / 1e6),
    Math.min(Math.max(0, Number(bounds.cashMax) / 1e6), value),
  );
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
    `${terms.name} · ${terms.quantity} share-equivalent${terms.quantity === 1 ? '' : 's'} · ${terms.expiry}`,
    -cost,
    0,
    id,
  );
  return id;
}
export function closeOrder(book: VaultBook, id: string, quotedValue?: number) {
  const p = book.options.find((p) => p.id === id && p.status === 'active');
  if (!p) throw Error('This active contract was not found.');
  const cost = quotedValue ?? premium(p.terms, book);
  signedTransfer(book.counterparty, book.vault, 'USDC', cost);
  p.status = 'closed';
  p.cashFlow = cost;
  p.stockFlow = 0;
  assertCollateral(book);
  emit(book, 'Contract closed', p.terms.name, cost, 0, id);
}
export function setMarketDate(book: VaultBook, date: string) {
  mark(date);
  if (date <= book.date)
    throw Error('The test market can only advance to a later stored session.');
  book.date = date;
  // All positions expiring together clear atomically. Never remove just one hedge
  // from a shared collateral set before settling its offsetting obligations.
  const due = book.options.filter(
    (p) => p.status === 'active' && p.terms.expiry <= date,
  );
  const byExpiry = new Map<string, typeof due>();
  for (const p of due) {
    const group = byExpiry.get(p.terms.expiry) || [];
    group.push(p);
    byExpiry.set(p.terms.expiry, group);
  }
  for (const [expiry, positions] of [...byExpiry].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let cash = 0,
      shares = 0;
    for (const p of positions) {
      const observation =
        p.terms.reference === 'dividend' ? DIVIDEND : mark(expiry);
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
    signedTransfer(book.counterparty, book.vault, 'NVDA', shares);
    emit(
      book,
      'Expiry settled',
      `${positions.length} contract${positions.length === 1 ? '' : 's'} cleared together · ${expiry}`,
      cash,
      shares,
    );
  }
  for (const p of book.shorts.filter(
    (p) => p.status === 'active' && p.expiry <= date,
  ))
    closeShort(book, p, p.expiry);
  for (const p of book.loans.filter(
    (p) => p.status === 'active' && p.expiry <= date,
  ))
    closeLoan(book, p, p.expiry);
  emit(
    book,
    'Market session advanced',
    `${date} · NVDA $${mark(date).toFixed(2)} historical close`,
  );
  assertCollateral(book);
}
export function openLoan(book: VaultBook, quantity: number, expiry: string) {
  if (quantity > risk(book).freeShares)
    throw Error(
      'Shares already committed to another obligation cannot be lent.',
    );
  const entry = mark(book.date),
    cap = round(entry * 1.5);
  const protection = premium(
    {
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
  transfer(book.vault, book.market, 'NVDA', quantity);
  transfer(book.market, book.counterparty, 'USDC', mul(quantity, entry));
  transfer(book.counterparty, book.market, 'USDC', protection);
  book.counterparty.USDC = add(book.counterparty.USDC, -total);
  const p: LendingPosition = {
    productive: { entry, cap, premium: protection },
    id: randomUUID(),
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
    `${quantity} NVDA sold by borrower · 150% strike protection and full-term interest funded`,
    0,
    -quantity,
    p.id,
  );
}
export function closeLoan(book: VaultBook, p: LendingPosition, at = book.date) {
  if (p.status !== 'active') throw Error('This stock loan is already closed.');
  const earned = accruedInterest(p.prepaidInterest, p.opened, p.expiry, at);
  if (p.productive) {
    const repurchase = mul(p.quantity, Math.min(mark(at), p.productive.cap));
    book.market.USDC = add(book.market.USDC, repurchase);
    transfer(book.market, book.vault, 'NVDA', p.quantity);
  } else transfer(book.counterparty, book.vault, 'NVDA', p.quantity);
  book.vault.USDC = add(book.vault.USDC, earned);
  book.counterparty.USDC = add(
    book.counterparty.USDC,
    add(
      add(
        p.collateral,
        -(p.productive
          ? mul(p.quantity, Math.min(mark(at), p.productive.cap))
          : 0),
      ),
      add(p.prepaidInterest, -earned),
    ),
  );
  p.status = 'closed';
  p.earned = earned;
  emit(
    book,
    'Lent shares returned',
    `${p.quantity} NVDA returned; accrued interest credited`,
    earned,
    p.quantity,
    p.id,
  );
}
export function openShort(
  book: VaultBook,
  quantity: number,
  cap: number,
  expiry: string,
) {
  const entry = mark(book.date);
  if (cap <= entry || cap > entry * 2)
    throw Error(
      'Choose a protective strike above the reference price and at most twice that price.',
    );
  const terms: OrderTerms = {
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
  transfer(book.counterparty, book.market, 'NVDA', quantity);
  transfer(book.market, book.vault, 'USDC', mul(quantity, entry));
  transfer(book.vault, book.counterparty, 'USDC', cost);
  const p: ShortPosition = {
    id: randomUUID(),
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
    `${quantity} NVDA sold · ${cap} protective call · maximum repayment funded`,
    add(mul(quantity, entry), -cost),
    0,
    p.id,
  );
}
export function closeShort(book: VaultBook, p: ShortPosition, at = book.date) {
  if (p.status !== 'active') throw Error('This short is already closed.');
  const spot = mark(at),
    { repurchase: cost, interest, pnl } = shortCloseAmounts(p, spot, at);
  if (spot > p.cap) {
    // Call exercise supplies the shares used to repay the same borrow: the
    // counterparty delivers then receives them atomically, so no net stock move.
    transfer(book.vault, book.counterparty, 'USDC', cost);
  } else {
    transfer(book.vault, book.market, 'USDC', cost);
    transfer(book.market, book.counterparty, 'NVDA', p.quantity);
  }
  transfer(book.vault, book.counterparty, 'USDC', interest);
  p.status = 'closed';
  p.pnl = pnl;
  emit(
    book,
    'Protected short closed',
    `${p.quantity} NVDA borrow repaid · protective call retired`,
    -add(cost, interest),
    0,
    p.id,
  );
}
export function totals(book: VaultBook) {
  const balances = [book.wallet, book.vault, book.counterparty, book.market];
  let cash = balances.reduce((s, b) => s + units(b.USDC), 0n);
  for (const p of book.loans.filter((p) => p.status === 'active'))
    cash += units(p.collateral) + units(p.prepaidInterest);
  const shares = balances.reduce((s, b) => s + units(b.NVDA), 0n);
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
    units(balance.NVDA);
  }
  const current = totals(book);
  if (current.cash !== original.cash || current.shares !== original.shares)
    throw Error('Asset conservation failed; transaction rolled back.');
  assertCollateral(book);
}
