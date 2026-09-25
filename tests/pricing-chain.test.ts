import test from 'node:test';
import assert from 'node:assert/strict';
import { setLiveMarket, type LiveMarket } from '../lib/parcel/market';
import {
  halfSpread,
  legCrossingCost,
  MODEL_LIQUIDITY,
  quoteAround,
  spreadCost,
} from '../lib/parcel/spread';
import { optionGreeks, round } from '../lib/parcel/math';
import { protectionPremium } from '../lib/parcel/funding';
import { templateTerms } from '../lib/parcel/templates';
import { mark, volatility } from '../lib/parcel/market';
import {
  borrowRate,
  rates,
  RESTING_UTILISATION,
  reserveOf,
} from '../lib/parcel/lending';
import {
  clampExecutablePremium,
  payoffBounds,
} from '../lib/parcel/envelope';
import {
  initialVault,
  premium,
  tradedPremium,
  openLoan,
  openShort,
  closeOrder,
  addOrder,
} from '../server/parcel/ledger';
import {
  actionBytes,
  bookBytes,
  ONCHAIN_ACTIONS,
} from '../server/parcel/chain/codec';
import type { VaultPlan } from '../server/parcel/service';

void test('pricing: option mid is Black-Scholes; live ask/bid add modelled crossing', () => {
  const book = initialVault();
  const terms = templateTerms('call', '2025-02-07');
  terms.quantity = 1;
  const spot = mark('NVDA', book.date);
  const days =
    (Date.parse(terms.expiry) - Date.parse(book.date)) / 86_400_000;
  const bs = optionGreeks(
    'call',
    spot,
    terms.legs[0].strike,
    days,
    volatility('NVDA'),
  ).price;
  assert.equal(round(premium(terms, book)), round(bs));
  assert.equal(tradedPremium(terms, book), premium(terms, book));

  const market: LiveMarket = {
    spot: () => spot,
    close: () => null,
    expiries: () => [terms.expiry],
  };
  setLiveMarket(market);
  try {
    book.date = '2025-01-24T12:00:00.000Z';
    const mid = premium(terms, book);
    const crossing = spreadCost(
      terms,
      spot,
      book.date,
      volatility('NVDA'),
    );
    assert.ok(crossing > 0);
    assert.equal(tradedPremium(terms, book), round(mid + crossing));
    assert.equal(
      tradedPremium(terms, book, 'close'),
      round(-mid + crossing),
    );
    const around = quoteAround(mid, crossing);
    assert.equal(around.ask, tradedPremium(terms, book));
    assert.equal(around.bid, -tradedPremium(terms, book, 'close'));
    assert.ok(
      legCrossingCost(mid, MODEL_LIQUIDITY.displayedSize * 4) /
        (MODEL_LIQUIDITY.displayedSize * 4) >
        halfSpread(mid),
      'participation raises per-share cost past the touch',
    );
  } finally {
    setLiveMarket(null);
  }
});

void test('pricing: stock-loan and protected-short premia are Black-Scholes protection calls', () => {
  const book = initialVault();
  book.vault.USDC = 5000;
  book.vault.NVDA = 2;
  const quantity = 0.5,
    expiry = '2025-02-07',
    entry = mark('NVDA', book.date),
    cap = round(entry * 1.5);
  const expected = protectionPremium(
    quantity,
    entry,
    cap,
    book.date,
    expiry,
    volatility('NVDA'),
  );
  openShort(book, quantity, cap, expiry);
  assert.equal(book.shorts[0].premium, expected);
  openLoan(book, quantity, expiry);
  assert.equal(book.loans[0].productive?.premium, expected);
  assert.equal(
    expected,
    round(
      optionGreeks(
        'call',
        entry,
        cap,
        (Date.parse(expiry) - Date.parse(book.date)) / 86_400_000,
        volatility('NVDA'),
      ).price * quantity,
    ),
  );
});

void test('pricing: unquoted closeOrder credits the live bid, not the mid', () => {
  const book = initialVault();
  const market: LiveMarket = {
    spot: () => 142.62,
    close: () => null,
    expiries: () => ['2025-02-07'],
  };
  setLiveMarket(market);
  try {
    book.date = '2025-01-24T12:00:00.000Z';
    book.vault.USDC = 1000;
    const terms = templateTerms('call', '2025-02-07');
    terms.quantity = 1;
    const ask = tradedPremium(terms, book);
    addOrder(book, terms, ask);
    const before = book.vault.USDC;
    const bidCredit = -tradedPremium(terms, book, 'close');
    closeOrder(book, book.options[0].id);
    assert.equal(book.options[0].cashFlow, bidCredit);
    assert.equal(book.vault.USDC, round(before + bidCredit));
    assert.ok(ask > bidCredit, 'round-trip loses the modelled spread');
  } finally {
    setLiveMarket(null);
  }
});

void test('pricing: live open ask never exceeds the on-chain bounded payoff envelope', () => {
  const market: LiveMarket = {
    spot: () => 142.62,
    close: () => null,
    expiries: () => ['2025-02-07'],
  };
  setLiveMarket(market);
  try {
    const book = initialVault();
    book.date = '2025-01-24T12:00:00.000Z';
    // Deep ITM short window: mid sits on the width, so unclamped crossing
    // would push past max payable value and fail Action::Open on-chain.
    const spread = templateTerms('call-spread', '2025-02-07');
    spread.legs = [
      { kind: 'call', side: 'buy', strike: 100, ratio: 1 },
      { kind: 'call', side: 'sell', strike: 110, ratio: 1 },
    ];
    spread.quantity = 1;
    const mid = premium(spread, book);
    const unclamped =
      mid + spreadCost(spread, 142.62, book.date, volatility('NVDA'));
    const hi = Number(payoffBounds(spread).cashMax) / 1e6;
    assert.ok(mid > hi * 0.9);
    assert.ok(unclamped > hi);
    assert.equal(tradedPremium(spread, book), hi);
    assert.equal(clampExecutablePremium(spread, unclamped), hi);

    const write = {
      ...spread,
      legs: spread.legs.map((l) => ({
        ...l,
        side: l.side === 'buy' ? ('sell' as const) : ('buy' as const),
      })),
    };
    const credit = tradedPremium(write, book);
    assert.ok(credit < 0);
    assert.ok(credit >= Number(payoffBounds(write).cashMin) / 1e6);
  } finally {
    setLiveMarket(null);
  }
});

void test('pricing: Black-Scholes zero-vol and expiry collapse; input guards hold', () => {
  const model = { riskFreeRate: 0.04, dividendYield: 0.01 };
  const zeroVol = optionGreeks('call', 100, 95, 90, 0, model);
  const atExpiry = optionGreeks('call', 100, 95, 0, 0.4, model);
  const t = 90 / 365;
  const forward = 100 * Math.exp((0.04 - 0.01) * t);
  const discount = Math.exp(-0.04 * t);
  assert.ok(
    Math.abs(zeroVol.price - discount * Math.max(0, forward - 95)) < 1e-12,
  );
  assert.equal(atExpiry.price, 5);
  assert.equal(atExpiry.gamma, 0);
  assert.throws(() => optionGreeks('call', 100, 100, 30, 10.1));
  assert.throws(() => optionGreeks('call', 0, 100, 30, 0.2));
  assert.throws(() => quoteAround(1, -0.01));
  assert.throws(() => legCrossingCost(10, -1));
});

void test('codec: borrow/repay and lend/short are onchain actions; book encodes active borrows', () => {
  assert.ok(ONCHAIN_ACTIONS.has('borrow'));
  assert.ok(ONCHAIN_ACTIONS.has('repay'));
  assert.ok(ONCHAIN_ACTIONS.has('lend'));
  assert.ok(ONCHAIN_ACTIONS.has('short'));
  assert.ok(ONCHAIN_ACTIONS.has('execute'));

  const before = initialVault();
  const book = structuredClone(before);
  book.vault.NVDA = 2;
  book.vault.USDC = 50;
  book.market.USDC = before.market.USDC - 50;
  book.borrows = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      symbol: 'NVDA',
      pledged: 1,
      principal: 50,
      rate: 'variable',
      apr: 0.05,
      opened: book.date,
      accrued: 0,
      accruedTo: book.date,
      status: 'active',
    },
  ];
  const bytes = bookBytes(book);
  assert.ok(bytes.length > bookBytes(before).length);

  const plan = {
    revision: 1,
    before,
    book,
    action: {
      type: 'borrow',
      symbol: 'NVDA',
      pledged: 1,
      amount: 50,
      rate: 'variable',
    },
    hash: 'test',
  } as VaultPlan;
  const encoded = actionBytes(plan);
  assert.equal(encoded[0], 11);
  assert.equal(
    actionBytes({
      ...plan,
      action: { type: 'repay', id: book.borrows[0].id },
    })[0],
    12,
  );
});

void test('pricing: cash-borrow APR is the pool curve, never Black-Scholes', () => {
  const reserve = reserveOf('NVDA')!;
  const apr = borrowRate('NVDA', null);
  assert.equal(
    apr,
    Math.round(rates(RESTING_UTILISATION, reserve).borrow * 1e6) / 1e6,
  );
  const call = optionGreeks('call', 142.62, 145, 14, 0.45).price;
  assert.notEqual(call, apr);
});
