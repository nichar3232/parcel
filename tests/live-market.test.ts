import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  listedExpiryInstant,
  modelDays,
  setLiveMarket,
  type LiveMarket,
} from '../lib/parcel/market';
import { closeInstant, fridayExpiries, LiveMarketService } from '../server/prices/live';
import { MarkEngine } from '../server/prices/engine';
import type { Source } from '../server/prices/sources';
import { Store } from '../server/db/store';
import { VaultService } from '../server/parcel/service';
import {
  addOrder,
  initialVault,
  premium,
  syncLive,
  totals,
  transfer,
  validateLedger,
} from '../server/parcel/ledger';
import { parseOrderTerms } from '../lib/parcel/validation';

void test('live expiries are the coming Fridays, then third-Friday monthlies', () => {
  // Wednesday 23 September 2026, early morning in New York.
  const dates = fridayExpiries('2026-09-23T08:00:00.000Z');
  assert.equal(dates[0], '2026-09-25');
  assert.equal(dates.length >= 8, true);
  for (const d of dates)
    assert.equal(new Date(`${d}T12:00:00Z`).getUTCDay(), 5, `${d} is a Friday`);
  // October's third Friday is the 16th; December's the 18th.
  assert.ok(dates.includes('2026-10-16'));
  assert.ok(dates.includes('2026-12-18'));
  // Never today, even on a Friday before the bell.
  assert.ok(!fridayExpiries('2026-09-25T14:00:00.000Z').includes('2026-09-25'));
});

void test('the settlement close is 4pm New York on both sides of daylight saving', () => {
  assert.equal(
    new Date(closeInstant('2026-09-25')).toISOString(),
    '2026-09-25T20:00:00.000Z',
  );
  assert.equal(
    new Date(closeInstant('2026-12-18')).toISOString(),
    '2026-12-18T21:00:00.000Z',
  );
});

void test('live option valuation carries a date-only expiry through the New York close', () => {
  const market: LiveMarket = {
    spot: () => 100,
    close: () => null,
    expiries: () => [],
  };
  setLiveMarket(market);
  try {
    const from = '2026-12-18T18:00:00.000Z';
    assert.equal(
      new Date(listedExpiryInstant('2026-12-18')).toISOString(),
      '2026-12-18T21:00:00.000Z',
    );
    assert.equal(modelDays(from, '2026-12-18'), 3 / 24);
  } finally {
    setLiveMarket(null);
  }
});

void test('a live book prices at the mark and settles at the recorded expiry close', () => {
  let spot = 229.2;
  const closes = new Map<string, number>();
  const market: LiveMarket = {
    spot: () => spot,
    close: (symbol, date) => closes.get(`${symbol}|${date}`) ?? null,
    expiries: (now) => fridayExpiries(now),
  };
  setLiveMarket(market);
  try {
    const book = initialVault();
    assert.equal(book.clock, 'live');
    book.date = '2026-09-23T14:00:00.000Z';
    transfer(book.wallet, book.vault, 'USDC', 1000);
    const original = totals(book);
    const terms = parseOrderTerms(
      {
        symbol: 'NVDA',
        name: 'Call spread',
        quantity: 1,
        expiry: '2026-09-25',
        settlement: 'cash',
        reference: 'stock',
        legs: [
          { kind: 'call', side: 'buy', strike: 230, ratio: 1 },
          { kind: 'call', side: 'sell', strike: 250, ratio: 1 },
        ],
      },
      book.date,
    );
    const cost = premium(terms, book);
    assert.ok(
      cost > 0 && cost < 10,
      `premium ${cost} is priced at the live mark`,
    );
    addOrder(book, terms, cost);

    // The day after expiry, but the venue has not printed a close yet:
    // nothing settles and nothing is invented.
    spot = 240;
    assert.equal(syncLive(book, '2026-09-26T01:00:00.000Z'), false);
    assert.equal(book.options[0].status, 'active');

    // Once the close is recorded it settles there, not at the live mark.
    closes.set('NVDA|2026-09-25', 236);
    assert.equal(syncLive(book, '2026-09-26T01:05:00.000Z'), true);
    assert.equal(book.options[0].status, 'settled');
    assert.equal(book.options[0].cashFlow, 6);
    validateLedger(book, original);

    // Unknown expiries are refused rather than silently accepted.
    assert.throws(
      () => parseOrderTerms({ ...terms, expiry: '2026-09-24' }, book.date),
      /listed expiry/,
    );
  } finally {
    setLiveMarket(null);
  }
});

void test('live stock transfers only receive a fresh consolidated NBBO', () => {
  const now = Date.now();
  const nbbo: Source = {
    name: 'massive-nbbo',
    enabled: true,
    async observe() {
      return [];
    },
    subscribe(_instruments, receive) {
      receive([
        {
          symbol: 'NVDA',
          price: 142.62,
          bid: 142.61,
          ask: 142.63,
          bidSize: 400,
          askSize: 600,
          at: now,
          source: 'massive-nbbo',
          quoteKind: 'nbbo',
        },
      ]);
      return () => undefined;
    },
  };
  const engine = new MarkEngine(now, [nbbo]);
  const store = new Store(':memory:');
  engine.start();
  try {
    const market = new LiveMarketService(engine, store);
    assert.deepEqual(market.quote('NVDA'), {
      bid: 142.61,
      ask: 142.63,
      bidSize: 400,
      askSize: 600,
    });
  } finally {
    engine.stop();
    store.close();
  }
});

void test('an oracle or delayed modelled mark cannot be used as a stock execution quote', () => {
  const now = Date.now();
  const oracle: Source = {
    name: 'pyth',
    enabled: true,
    async observe() {
      return [];
    },
    subscribe(_instruments, receive) {
      receive([
        {
          symbol: 'NVDA',
          price: 142.62,
          at: now,
          source: 'pyth',
          quoteKind: 'oracle',
        },
      ]);
      return () => undefined;
    },
  };
  const engine = new MarkEngine(now, [oracle]);
  const store = new Store(':memory:');
  engine.start();
  try {
    const market = new LiveMarketService(engine, store);
    assert.equal(market.spot('NVDA'), 142.62, 'the mark remains displayable');
    assert.equal(market.quote('NVDA'), null, 'but it is not a two-sided venue book');
  } finally {
    engine.stop();
    store.close();
  }
});

void test('a live stock simulation cannot consume more than the displayed NBBO side', () => {
  const market: LiveMarket = {
    spot: () => 142.62,
    close: () => null,
    expiries: () => [],
    quote: () => ({ bid: 142.61, ask: 142.63, bidSize: 0.25, askSize: 0.5 }),
  };
  const store = new Store(':memory:');
  setLiveMarket(market);
  try {
    const session = store.createSession().session;
    const vault = new VaultService(store);
    let state = vault.snapshot(session);
    state = vault.apply(session, randomUUID(), {
      revision: state.revision,
      action: { type: 'transfer', direction: 'deposit', asset: 'USDC', amount: 1000 },
    });

    assert.throws(
      () =>
        vault.plan(session, {
          revision: state.revision,
          action: { type: 'stock', side: 'buy', symbol: 'NVDA', quantity: 0.500001 },
        }),
      /exceeds the current displayed ask size/,
    );

    const plan = vault.plan(session, {
      revision: state.revision,
      action: { type: 'stock', side: 'buy', symbol: 'NVDA', quantity: 0.5 },
    });
    assert.equal(plan.book.vault.NVDA, 0.5);
  } finally {
    setLiveMarket(null);
    store.close();
  }
});
