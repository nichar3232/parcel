import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService } from '../server/parcel/service';
import { initialVault, totals, validateLedger } from '../server/parcel/ledger';
import {
  add,
  cashPayoff,
  deliveries,
  mul,
  optionGreeks,
  orderGreeks,
} from '../lib/parcel/math';
import { curveCash } from '../lib/parcel/curves';
import { units } from '../lib/engine';
import {
  borrowDebt,
  borrowInterest,
  protectionPremium,
} from '../lib/parcel/funding';
import {
  borrowRate,
  rates,
  reserveOf,
  RESTING_UTILISATION,
} from '../lib/parcel/lending';
import { mark, volatility } from '../lib/parcel/market';
import { marginGroups } from '../lib/parcel/risk';
import { strikeStep, templateTerms, templates } from '../lib/parcel/templates';
import type { OrderTerms, VaultAction } from '../lib/parcel/types';
function setup() {
  const store = new Store(':memory:'),
    { session } = store.createSession();
  let now = 1800000000000;
  const service = new VaultService(store, () => now);
  let state = service.snapshot(session);
  const act = (action: VaultAction) =>
    (state = service.apply(session, randomUUID(), {
      revision: state.revision,
      action,
    }));
  const deposit = (asset: 'NVDA' | 'USDC', amount: number) =>
    act({ type: 'transfer', asset, amount, direction: 'deposit' });
  const quote = (terms: OrderTerms) =>
    service.quote(session, randomUUID(), { revision: state.revision, terms });
  const execute = (terms: OrderTerms) => {
    const q = quote(terms);
    assert.equal(q.eligible, true, q.reason);
    act({ type: 'execute', quoteId: q.id });
    return state.book.options[0];
  };
  return {
    store,
    session,
    service,
    act,
    deposit,
    quote,
    execute,
    get state() {
      return state;
    },
    setNow: (value: number) => {
      now = value;
    },
    refresh: () => (state = service.snapshot(session)),
  };
}
void test('vault: deposits and withdrawals conserve exact fractional cash and shares', () => {
  const a = setup();
  try {
    const before = totals(a.state.book);
    a.deposit('NVDA', 0.333333);
    a.deposit('USDC', 0.123456);
    assert.equal(a.state.book.vault.NVDA, 0.333333);
    a.act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'NVDA',
      amount: 0.333333,
    });
    a.act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'USDC',
      amount: 0.123456,
    });
    assert.equal(a.state.book.wallet.USDC, 10000);
    assert.equal(a.state.book.wallet.NVDA, 25);
    assert.deepEqual(totals(a.state.book), before);
  } finally {
    a.store.close();
  }
});
void test('vault: invalid amounts, unsupported assets and insufficient funding cannot mutate the book', () => {
  const a = setup();
  try {
    const before = a.state;
    for (const amount of [-1, 0, NaN, Infinity, 0.0000001, 1000001])
      assert.throws(() =>
        a.act({
          type: 'transfer',
          direction: 'deposit',
          asset: 'USDC',
          amount,
        }),
      );
    assert.throws(() => a.deposit('USDC', 10001), /Insufficient/);
    assert.throws(() => a.deposit('NVDA', 26), /Insufficient/);
    assert.deepEqual(a.refresh().book, before.book);
    assert.equal(a.state.revision, 0);
  } finally {
    a.store.close();
  }
});
void test('vault: quote execution is owner-bound, revision-bound, expiring and exactly once', () => {
  const a = setup();
  try {
    a.deposit('USDC', 1000);
    const terms = templateTerms('call-spread', '2025-01-31'),
      q = a.quote(terms);
    const key = randomUUID(),
      body = {
        revision: a.state.revision,
        action: { type: 'execute', quoteId: q.id },
      };
    const first = a.service.apply(a.session, key, body);
    assert.deepEqual(a.service.apply(a.session, key, body), first);
    a.refresh();
    assert.equal(a.state.book.options.length, 1);
    assert.throws(
      () => a.act({ type: 'execute', quoteId: q.id }),
      /already executed/,
    );
    const q2 = a.quote(terms);
    const { session: foreign } = a.store.createSession();
    const fs = a.service.snapshot(foreign);
    assert.throws(
      () =>
        a.service.apply(foreign, randomUUID(), {
          revision: fs.revision,
          action: { type: 'execute', quoteId: q2.id },
        }),
      /does not belong/,
    );
    a.setNow(q2.expiresAt);
    assert.throws(() => a.act({ type: 'execute', quoteId: q2.id }), /expired/);
    assert.equal(a.refresh().book.options.length, 1);
  } finally {
    a.store.close();
  }
});
void test('vault: an older idempotent receipt is completed with the current market metadata', () => {
  const a = setup();
  try {
    const key = randomUUID(),
      request = {
        revision: a.state.revision,
        action: {
          type: 'transfer' as const,
          asset: 'USDC' as const,
          direction: 'deposit' as const,
          amount: 1000,
        },
      },
      first = a.service.apply(a.session, key, request),
      { underlyings: _underlyings, ...legacyMarket } = first.market,
      legacyReceipt = { ...first, market: legacyMarket };

    // Simulate a durable receipt created before the market list was added to
    // the response contract. It must remain idempotent without crashing a
    // current client that relies on that list for its holdings view.
    a.store.db
      .prepare('UPDATE receipts SET response=? WHERE owner=? AND key=?')
      .run(JSON.stringify(legacyReceipt), a.session.id, key);

    const retried = a.service.apply(a.session, key, request);
    assert.equal(retried.revision, first.revision);
    assert.deepEqual(retried.book, first.book);
    assert.equal(retried.market.underlyings.length, 9);
    assert.equal(retried.market.underlyings[0]?.symbol, 'NVDA');
  } finally {
    a.store.close();
  }
});
void test('vault: stale quote, stale tab and reused key with different action are rejected', () => {
  const a = setup();
  try {
    a.deposit('USDC', 1000);
    const q = a.quote(templateTerms('call-spread', '2025-01-31'));
    a.deposit('USDC', 1);
    assert.throws(
      () => a.act({ type: 'execute', quoteId: q.id }),
      /changed since/,
    );
    assert.throws(
      () =>
        a.service.apply(a.session, randomUUID(), {
          revision: 0,
          action: { type: 'margin', mode: 'isolated' },
        }),
      /changed/,
    );
    const key = randomUUID(),
      request = {
        revision: a.state.revision,
        action: { type: 'margin', mode: 'cross' },
      };
    a.service.apply(a.session, key, request);
    assert.throws(
      () =>
        a.service.apply(a.session, key, {
          ...request,
          action: { type: 'margin', mode: 'isolated' },
        }),
      /different terms/,
    );
  } finally {
    a.store.close();
  }
});
void test('vault: covered fractional call cannot pledge stock twice; physical assignment transfers exact assets', () => {
  const a = setup();
  try {
    a.deposit('NVDA', 0.333333);
    const terms = templateTerms('covered-call', '2025-01-27');
    terms.quantity = 0.333333;
    terms.legs[0].strike = 100;
    const p = a.execute(terms);
    assert.equal(a.state.risk.shares.NVDA, 0.333333);
    const before = a.state.book.vault.USDC;
    assert.throws(
      () =>
        a.act({
          type: 'transfer',
          direction: 'withdraw',
          asset: 'NVDA',
          amount: 0.000001,
        }),
      /collateral|available/,
    );
    assert.throws(
      () => a.act({ type: 'lend', quantity: 0.000001, expiry: '2025-01-31' }),
      /already committed/,
    );
    assert.throws(
      () => a.act({ type: 'stock', side: 'sell', quantity: 0.000001 }),
      /available/,
    );
    a.act({ type: 'advance', date: '2025-01-27' });
    assert.equal(a.state.book.vault.NVDA, 0);
    assert.ok(Math.abs(a.state.book.vault.USDC - before - 33.3333) < 1e-9);
    assert.equal(
      a.state.book.options.find((x) => x.id === p.id)?.status,
      'settled',
    );
    assert.equal(a.state.risk.shares.NVDA, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: cash-secured put assignment buys precisely one share at the strike', () => {
  const a = setup();
  try {
    a.deposit('USDC', 130);
    const p = a.execute(templateTerms('secured-put', '2025-01-27'));
    assert.equal(a.state.risk.cash, 130);
    a.act({ type: 'advance', date: '2025-01-27' });
    assert.equal(a.state.book.vault.NVDA, 1);
    assert.ok(Math.abs(a.state.book.vault.USDC + p.premium) < 1e-9);
    assert.equal(a.state.book.options[0].cashFlow, -130);
    assert.equal(a.state.risk.cash, 0);
  } finally {
    a.store.close();
  }
});
void test('vault: cross collateral only releases matched expiry exposure and protects hedge removal', () => {
  const a = setup();
  try {
    a.deposit('USDC', 100);
    const first = templateTerms('put-spread', '2025-01-31');
    const p = a.execute(first);
    const opposite = structuredClone(first);
    opposite.legs = opposite.legs.map((l) => ({
      ...l,
      side: l.side === 'buy' ? 'sell' : 'buy',
    }));
    a.execute(opposite);
    assert.equal(a.state.risk.cash, 0);
    assert.equal(a.state.risk.shares.NVDA, 0);
    assert.equal(a.state.risk.releasedValue, 10);
    a.act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'USDC',
      amount: a.state.book.vault.USDC,
    });
    const close = a.service.quote(a.session, randomUUID(), {
      revision: a.state.revision,
      positionId: p.id,
    });
    assert.equal(close.eligible, false);
    assert.throws(
      () => a.act({ type: 'execute', quoteId: close.id }),
      /collateral/,
    );
    assert.throws(
      () => a.act({ type: 'margin', mode: 'isolated' }),
      /collateral/,
    );
    const before = a.state.book.vault.USDC;
    a.act({ type: 'advance', date: '2025-01-31' });
    assert.equal(a.state.book.vault.USDC, before);
    assert.ok(a.state.book.options.every((p) => p.status === 'settled'));
    assert.throws(
      () => a.act({ type: 'advance', date: '2025-01-31' }),
      /later/,
    );
  } finally {
    a.store.close();
  }
});
void test('vault: different expiries do not net; isolated mode reserves independently', () => {
  const a = setup();
  try {
    a.deposit('USDC', 100);
    a.execute(templateTerms('put-spread', '2025-01-31'));
    const other = templateTerms('put-spread', '2025-02-07');
    other.legs = other.legs.map((l) => ({
      ...l,
      side: l.side === 'buy' ? 'sell' : 'buy',
    }));
    a.execute(other);
    assert.equal(a.state.risk.groups.length, 2);
    assert.equal(a.state.risk.cash, 10);
    assert.equal(a.state.risk.releasedValue, 0);
    a.act({ type: 'margin', mode: 'isolated' });
    assert.equal(a.state.risk.cash, 10);
  } finally {
    a.store.close();
  }
});
void test('vault: stock loan prefunds interest and collateral; recall returns assets once', () => {
  const a = setup();
  try {
    a.deposit('NVDA', 1);
    const cash = a.state.book.vault.USDC;
    a.act({ type: 'lend', quantity: 1, expiry: '2025-02-07' });
    const p = a.state.book.loans[0];
    assert.equal(a.state.book.vault.NVDA, 0);
    assert.equal(p.collateral, 213.93);
    assert.throws(
      () =>
        a.act({
          type: 'transfer',
          asset: 'NVDA',
          direction: 'withdraw',
          amount: 1,
        }),
      /Insufficient/,
    );
    a.act({ type: 'advance', date: '2025-01-31' });
    a.act({ type: 'recall', id: p.id });
    assert.equal(a.state.book.vault.NVDA, 1);
    assert.ok(a.state.book.vault.USDC > cash);
    assert.equal(
      a.state.book.loans[0].earned,
      Math.round(p.prepaidInterest * 0.5 * 1e6) / 1e6,
    );
    assert.throws(() => a.act({ type: 'recall', id: p.id }), /not found/);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: protected short covers from sale proceeds and locks maximum loss, including interest', () => {
  const a = setup();
  try {
    a.deposit('USDC', 100);
    a.act({ type: 'short', quantity: 1, cap: 160, expiry: '2025-01-31' });
    const p = a.state.book.shorts[0];
    assert.equal(a.state.risk.cash, 160 + p.maxInterest);
    assert.equal(a.state.risk.counterpartyShares.NVDA, 1);
    assert.throws(
      () =>
        a.act({
          type: 'transfer',
          asset: 'USDC',
          direction: 'withdraw',
          amount: a.state.book.vault.USDC,
        }),
      /collateral/,
    );
    a.act({ type: 'advance', date: '2025-01-27' });
    a.act({ type: 'close-short', id: p.id });
    assert.equal(a.state.book.shorts[0].status, 'closed');
    assert.ok(a.state.book.shorts[0].pnl! > 0);
    assert.equal(a.state.risk.cash, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: short above cap exercises reserved stock and stays within maximum loss', () => {
  const a = setup();
  try {
    a.deposit('USDC', 1000);
    a.act({ type: 'advance', date: '2025-01-27' });
    a.act({
      type: 'short',
      quantity: 0.333333,
      cap: 120,
      expiry: '2025-01-31',
    });
    const p = a.state.book.shorts[0],
      maxLoss = (p.cap - p.entry) * p.quantity + p.premium + p.maxInterest;
    a.act({ type: 'advance', date: '2025-01-28' });
    a.act({ type: 'close-short', id: p.id });
    assert.ok(-a.state.book.shorts[0].pnl! <= maxLoss + 0.00001);
    assert.equal(a.state.risk.counterpartyShares.NVDA, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: lending previews and execution use the underlying volatility and resting rate', () => {
  const a = setup();
  try {
    const symbol = 'OPENAI',
      quantity = 0.25,
      expiry = '2025-01-31',
      entry = mark(symbol, a.state.book.date),
      cap = Math.round(entry * 1.5 * 1e6) / 1e6,
      expectedProtection = protectionPremium(
        quantity,
        entry,
        cap,
        a.state.book.date,
        expiry,
        volatility(symbol),
      );

    // PreStocks deliberately carries a different model volatility from
    // NVDA. The displayed protective-call cost must remain the same one
    // the lender and short ledger actually funds.
    assert.notEqual(volatility(symbol), 0.45);
    a.deposit('USDC', 1000);
    a.act({ type: 'short', quantity, cap, expiry, symbol });
    assert.equal(a.state.book.shorts[0].premium, expectedProtection);

    a.act({
      type: 'transfer',
      direction: 'deposit',
      asset: symbol,
      amount: quantity,
    });
    a.act({ type: 'lend', quantity, expiry, symbol });
    assert.equal(a.state.book.loans[0].productive?.premium, expectedProtection);

    const reserve = reserveOf(symbol);
    assert.ok(reserve);
    assert.equal(
      borrowRate(symbol, null),
      rates(RESTING_UTILISATION, reserve).borrow,
    );
  } finally {
    a.store.close();
  }
});
void test('vault: cash borrowed against pledged stock is capped at loan-to-value, reserves the pledge and repays with interest', () => {
  const a = setup();
  try {
    a.deposit('NVDA', 2);
    // NVDA lends 60% of its value; one share at $142.62 carries $85.57.
    assert.throws(
      () =>
        a.act({
          type: 'borrow',
          pledged: 1,
          amount: 86,
          rate: 'variable',
        }),
      /lends up to 60%/,
    );
    a.act({ type: 'borrow', pledged: 1, amount: 50, rate: 'variable' });
    const p = a.state.book.borrows[0];
    assert.equal(p.rate, 'variable');
    assert.equal(p.apr, borrowRate('NVDA', null));
    assert.equal(a.state.book.vault.USDC, 50);
    assert.equal(a.state.risk.shares.NVDA, 1);
    assert.equal(a.state.risk.freeShares.NVDA, 1);
    assert.throws(
      () =>
        a.act({
          type: 'transfer',
          asset: 'NVDA',
          direction: 'withdraw',
          amount: 2,
        }),
      /available NVDA/,
    );
    // The borrowed cash itself is free to leave: that is what a loan is for.
    a.act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'withdraw',
      amount: 50,
    });
    a.act({ type: 'advance', date: '2025-01-27' });
    // Repaying needs the principal and the interest in the vault.
    assert.throws(
      () => a.act({ type: 'repay', id: p.id }),
      /Insufficient USDC/,
    );
    a.deposit('USDC', 51);
    const owed = borrowDebt(a.state.book.borrows[0], '2025-01-27');
    assert.ok(owed.interest > 0);
    assert.equal(owed.total, add(50, owed.interest));
    a.act({ type: 'repay', id: p.id });
    const closed = a.state.book.borrows[0];
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedBy, 'repaid');
    assert.equal(closed.paid, owed.interest);
    assert.equal(a.state.book.vault.USDC, add(51, -owed.total));
    assert.equal(a.state.book.vault.NVDA, 2);
    assert.equal(a.state.risk.shares.NVDA, 0);
    assert.throws(() => a.act({ type: 'repay', id: p.id }), /not found/);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: a fixed-rate loan locks its rate, settles at its term and sells the pledge when the cash is gone', () => {
  const a = setup();
  try {
    a.deposit('NVDA', 1);
    assert.throws(
      () => a.act({ type: 'borrow', pledged: 1, amount: 40, rate: 'fixed' }),
      /future session/,
    );
    a.act({
      type: 'borrow',
      pledged: 1,
      amount: 40,
      rate: 'fixed',
      expiry: '2025-01-31',
    });
    const p = a.state.book.borrows[0];
    assert.equal(p.expiry, '2025-01-31');
    const term = borrowInterest(40, p.apr, '2025-01-24', '2025-01-31');
    // Spend the loan, then let the term run out with nothing to repay it from.
    a.act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'withdraw',
      amount: 40,
    });
    a.act({ type: 'advance', date: '2025-01-27' });
    assert.equal(a.state.book.borrows[0].apr, p.apr);
    a.act({ type: 'advance', date: '2025-01-31' });
    const closed = a.state.book.borrows[0];
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedBy, 'expired');
    assert.equal(closed.paid, term);
    // The pledge was sold at the term's close and the debt taken from it;
    // the rest is the vault's.
    assert.equal(a.state.book.vault.NVDA, 0);
    assert.equal(
      a.state.book.vault.USDC,
      add(mul(1, mark('NVDA', '2025-01-31')), -add(40, term)),
    );
    assert.equal(a.state.risk.shares.NVDA, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: a loan whose pledge stops covering it is sold up at the liquidation threshold', () => {
  const a = setup();
  try {
    a.deposit('NVDA', 1);
    // Drawn to the limit at $142.62; the 27 January close is $118.42,
    // which at NVDA's 68% threshold covers $80.53 and not $85.
    a.act({ type: 'borrow', pledged: 1, amount: 85, rate: 'variable' });
    const p = a.state.book.borrows[0];
    a.act({ type: 'advance', date: '2025-01-27' });
    const closed = a.state.book.borrows[0];
    assert.equal(closed.id, p.id);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedBy, 'liquidated');
    const debt = add(85, closed.paid!),
      bonus = mul(debt, 0.09);
    assert.equal(a.state.book.vault.NVDA, 0);
    assert.equal(
      a.state.book.vault.USDC,
      add(add(85, mark('NVDA', '2025-01-27')), -add(debt, bonus)),
    );
    assert.ok(a.state.book.vault.USDC > 0);
    assert.ok(
      a.state.book.events.some((e) => e.title === 'Cash loan liquidated'),
    );
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: stock trades exchange assets, cannot oversell and cannot mint cash', () => {
  const a = setup();
  try {
    a.deposit('USDC', 500);
    a.act({ type: 'stock', side: 'buy', quantity: 1 });
    assert.equal(a.state.book.vault.NVDA, 1);
    assert.equal(a.state.book.vault.USDC, 357.38);
    a.act({ type: 'stock', side: 'sell', quantity: 1 });
    assert.equal(a.state.book.vault.USDC, 500);
    assert.throws(
      () => a.act({ type: 'stock', side: 'sell', quantity: 1 }),
      /Insufficient/,
    );
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: dividend cap settles from the committed event and conserves micro-unit payouts', () => {
  const a = setup();
  try {
    a.deposit('USDC', 1);
    const terms = templateTerms('dividend', '2025-03-12');
    terms.quantity = 0.333333;
    a.execute(terms);
    a.act({ type: 'advance', date: '2025-03-12' });
    assert.equal(a.state.book.options[0].cashFlow, 0.001666);
    assert.equal(a.state.book.options[0].status, 'settled');
    assert.equal(a.state.risk.cash, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
void test('vault: every structure accepts valid collateral and settles before final date', () => {
  for (const t of templates) {
    const a = setup();
    try {
      a.deposit('USDC', 5000);
      a.deposit('NVDA', 20);
      a.execute(templateTerms(t.id, '2025-02-07'));
      a.act({ type: 'advance', date: '2025-04-03' });
      assert.equal(a.state.book.options[0].status, 'settled', t.name);
      assert.equal(a.state.risk.cash, 0);
      assert.equal(a.state.risk.shares.NVDA, 0);
      validateLedger(a.state.book, totals(initialVault()));
    } finally {
      a.store.close();
    }
  }
});
void test('risk: independent dense price sampling never exceeds the exact collateral envelope', () => {
  for (const t of templates) {
    const terms = templateTerms(t.id, '2025-02-07');
    terms.quantity = 0.333333;
    const p = {
      id: t.id,
      terms,
      premium: 0,
      opened: '2025-01-24',
      status: 'active' as const,
    };
    const [r] = marginGroups([p], 'cross');
    for (let i = 0; i <= 2000; i++) {
      const spot = t.reference === 'dividend' ? i / 10000 : i / 5;
      const d = deliveries(terms, spot);
      assert.ok(
        d.cash >= -r.cash && d.cash <= r.counterpartyCash,
        `${t.id} cash at ${spot}`,
      );
      assert.ok(
        d.shares >= -r.shares && d.shares <= r.counterpartyShares,
        `${t.id} shares at ${spot}`,
      );
    }
  }
});
void test('math: share quantity scales premium and dollar theta without changing per-share decay', () => {
  const g = optionGreeks('call', 142.62, 145, 14);
  assert.ok(g.theta < 0);
  assert.ok(g.delta > 0 && g.delta < 1);
  assert.ok(g.gamma > 0 && g.vega > 0);
  const small = templateTerms('call', '2025-02-07');
  small.quantity = 0.25;
  const large = structuredClone(small);
  large.quantity = 100;
  const sg = orderGreeks(small, 142.62, '2025-01-24'),
    lg = orderGreeks(large, 142.62, '2025-01-24');
  assert.ok(Math.abs(lg.theta / sg.theta - 400) < 1e-9);
  assert.ok(Math.abs(lg.price / sg.price - 400) < 1e-9);
  const call = templateTerms('call-spread', '2025-02-07');
  assert.equal(cashPayoff(call, 155), 10);
  call.quantity = 0.333333;
  assert.equal(cashPayoff(call, 155), 3.33333);
  assert.equal(
    deliveries(templateTerms('covered-call', '2025-02-07'), 160).cash,
    150,
  );
});
void test('math: Black-Scholes prices, greeks and parity are analytical at any permitted size', () => {
  // The standard S=K=100, T=1, r=5%, sigma=20% reference case. Vega is
  // quoted per one volatility point, and theta per calendar day, matching the
  // values the ticket displays rather than leaving a hidden unit conversion.
  const model = { riskFreeRate: 0.05, dividendYield: 0 };
  const call = optionGreeks('call', 100, 100, 365, 0.2, model);
  const put = optionGreeks('put', 100, 100, 365, 0.2, model);
  const close = (actual: number, expected: number, tolerance = 1e-5) =>
    assert.ok(
      Math.abs(actual - expected) < tolerance,
      `expected ${actual} to be within ${tolerance} of ${expected}`,
    );

  close(call.price, 10.450584);
  close(put.price, 5.573526);
  close(call.delta, 0.636831);
  close(call.gamma, 0.018762);
  close(call.vega, 0.37524);
  close(call.theta, -0.017573, 2e-5);
  close(call.price - put.price, 100 - 100 * Math.exp(-0.05));

  const carryModel = { riskFreeRate: 0.04, dividendYield: 0.015 };
  const carryCall = optionGreeks('call', 100, 105, 180, 0.35, carryModel);
  const carryPut = optionGreeks('put', 100, 105, 180, 0.35, carryModel);
  close(
    carryCall.price - carryPut.price,
    100 * Math.exp(-0.015 * (180 / 365)) - 105 * Math.exp(-0.04 * (180 / 365)),
    1e-8,
  );

  const oneShare = templateTerms('call', '2025-02-07');
  oneShare.quantity = 1;
  const microShare = structuredClone(oneShare);
  microShare.quantity = 0.000001;
  const full = orderGreeks(oneShare, 142.62, '2025-01-24');
  const micro = orderGreeks(microShare, 142.62, '2025-01-24');
  for (const key of ['price', 'delta', 'gamma', 'theta', 'vega'] as const)
    close(micro[key] * 1_000_000, full[key], 1e-10);
  assert.equal(cashPayoff(microShare, 160), 0.000015);
});
void test('math: every template uses signed Black-Scholes legs and its expiry delivery exactly reproduces payoff', () => {
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(
      Math.abs(actual - expected) < 1e-6,
      `${label}: expected ${actual} to equal ${expected}`,
    );
  const model = { riskFreeRate: 0.031, dividendYield: 0.012 };

  for (const template of templates) {
    const terms = templateTerms(template.id, '2025-02-07');
    const spot = terms.reference === 'dividend' ? 0.01 : 142.62;
    const vol = terms.reference === 'dividend' ? 0.8 : 0.45;

    if (terms.curve) {
      const base = orderGreeks(terms, spot, '2025-01-24', vol, model);
      const higherRate = orderGreeks(terms, spot, '2025-01-24', vol, {
        ...model,
        riskFreeRate: 0.08,
      });
      assert.notEqual(
        base.price,
        higherRate.price,
        `${template.id} curve must use the shared Black-Scholes rate`,
      );
      continue;
    }

    const greeks = orderGreeks(terms, spot, '2025-01-24', vol, model);
    const independentlyPriced = terms.legs.reduce((total, leg) => {
      const side = leg.side === 'buy' ? 1 : -1;
      return (
        total +
        optionGreeks(
          leg.kind,
          spot,
          leg.strike,
          (Date.parse(terms.expiry) - Date.parse('2025-01-24')) / 86400000,
          vol,
          model,
        ).price *
          terms.quantity *
          leg.ratio *
          side
      );
    }, 0);
    close(greeks.price, independentlyPriced, `${template.id} model price`);

    const strikes = terms.legs.map((leg) => leg.strike);
    const points = [
      0,
      ...strikes.flatMap((strike) => [
        Math.max(0, strike - 0.000001),
        strike,
        strike + 0.000001,
      ]),
      Math.max(...strikes) * 2,
    ];
    for (const settlement of points) {
      const expected = terms.legs.reduce((total, leg) => {
        const intrinsic = Math.max(
          0,
          leg.kind === 'call'
            ? settlement - leg.strike
            : leg.strike - settlement,
        );
        return (
          total +
          intrinsic * terms.quantity * leg.ratio * (leg.side === 'buy' ? 1 : -1)
        );
      }, 0);
      close(
        cashPayoff(terms, settlement),
        expected,
        `${template.id} cash payoff at ${settlement}`,
      );
      if (terms.settlement === 'physical') {
        const delivery = deliveries(terms, settlement);
        close(
          delivery.cash + delivery.shares * settlement,
          cashPayoff(terms, settlement),
          `${template.id} physical delivery at ${settlement}`,
        );
      }
    }
  }
});
void test('math: curve templates scale with the selected underlying and keep their full payout envelope', () => {
  const baseSpot = 142.62;
  const targetSpot = 1_017.5;
  const ratio = targetSpot / baseSpot;
  const step = strikeStep(targetSpot);
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(
      Math.abs(actual - expected) < 0.000002,
      `${label}: expected ${actual} to equal ${expected}`,
    );

  for (const template of templates.filter((candidate) => candidate.curve)) {
    const nvda = templateTerms(template.id, '2025-02-07');
    const scaled = templateTerms(template.id, '2025-02-07', 'MSFT', targetSpot);
    assert.ok(nvda.curve && scaled.curve, `${template.id} must retain a curve`);
    if (nvda.reference === 'stock') {
      close(
        scaled.curve.lower,
        Math.round((nvda.curve.lower * ratio) / step) * step,
        `${template.id} lower strike scales`,
      );
      close(
        scaled.curve.upper,
        Math.round((nvda.curve.upper * ratio) / step) * step,
        `${template.id} upper strike scales`,
      );
      close(
        scaled.curve.cap,
        nvda.curve.cap * ratio,
        `${template.id} cap scales`,
      );
    } else {
      assert.deepEqual(scaled.curve, nvda.curve);
    }

    const curve = scaled.curve;
    const points = [
      0,
      curve.lower,
      (curve.lower + curve.upper) / 2,
      curve.upper,
      curve.upper * 2,
    ];
    for (const settlement of points) {
      const expected = Number(curveCash(scaled, settlement)) / 1e6;
      close(
        cashPayoff(scaled, settlement),
        expected,
        `${template.id} curve payoff at ${settlement}`,
      );
    }
    assert.equal(
      cashPayoff(scaled, 0),
      0,
      `${template.id} has no low-tail payout`,
    );
    close(
      cashPayoff(scaled, curve.upper * 2),
      curve.cap,
      `${template.id} reaches its disclosed cap`,
    );
  }
});
void test('math: every nonlinear ticket equals its integer settlement curve at expiry', () => {
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(
      Math.abs(actual - expected) < 1e-9,
      `${label}: expected ${actual} to equal ${expected}`,
    );
  for (const template of templates.filter((candidate) => candidate.curve)) {
    const terms = templateTerms(template.id, '2025-02-07');
    const curve = terms.curve!;
    for (const spot of [
      0,
      curve.lower - 0.000001,
      curve.lower,
      (curve.lower + curve.upper) / 2,
      curve.upper,
      curve.upper + 0.000001,
      curve.upper * 2,
    ])
      close(
        orderGreeks(terms, Math.max(0.000001, spot), terms.expiry).price,
        cashPayoff(terms, Math.max(0.000001, spot)),
        `${template.id} at ${spot}`,
      );
  }
});
void test('vault: a stored book reopens with its positions and revision intact', () => {
  const a = setup();
  try {
    a.deposit('USDC', 1000);
    a.execute(templateTerms('call-spread', '2025-02-07'));
    const next = new VaultService(a.store, () => 1800000000000);
    assert.deepEqual(next.snapshot(a.session), a.state);
    const independent = a.store.createSession();
    assert.equal(next.snapshot(independent.session).book.options.length, 0);
  } finally {
    a.store.close();
  }
});

void test('risk: cross-contract rounding cannot exceed collateral between strike boundaries', () => {
  const terms = templateTerms('secured-put', '2025-02-07');
  terms.quantity = 0.020402;
  terms.settlement = 'cash';
  const positions = [100.165478, 105.431558, 106.349041].map((strike, i) => ({
    id: String(i),
    premium: 0,
    opened: '2025-01-24',
    status: 'active' as const,
    terms: {
      ...terms,
      legs: [
        {
          kind: 'put' as const,
          side: i === 0 ? ('buy' as const) : ('sell' as const),
          ratio: i === 0 ? 2 : 1,
          strike,
        },
      ],
    },
  }));
  const [r] = marginGroups(positions, 'cross');
  const delivery = positions.reduce(
    (sum, p) => add(sum, deliveries(p.terms, 86.179546).cash),
    0,
  );
  assert.equal(delivery, -0.233596);
  assert.ok(r.cash >= -delivery);
  assert.ok(
    r.cash <=
      marginGroups(positions, 'isolated').reduce((s, g) => add(s, g.cash), 0),
  );
  const reverse = positions.map((p) => ({
    ...p,
    id: 'reverse-' + p.id,
    terms: {
      ...p.terms,
      legs: p.terms.legs.map((l) => ({
        ...l,
        side: l.side === 'buy' ? ('sell' as const) : ('buy' as const),
      })),
    },
  }));
  assert.equal(marginGroups([...positions, ...reverse], 'cross')[0].cash, 0);
  assert.equal(
    marginGroups([...positions, ...reverse], 'cross')[0].counterpartyCash,
    0,
  );
});
void test('risk: seeded mixed fractional cash portfolios are funded to the exact base unit', () => {
  let seed = 12345;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 100; trial++) {
    const positions = Array.from({ length: 2 + (trial % 5) }, (_, i) => {
      const terms = templateTerms(
        i % 2 ? 'put-spread' : 'call-spread',
        '2025-02-07',
      );
      terms.quantity = (1 + Math.floor(random() * 999999)) / 1e6;
      for (const l of terms.legs)
        l.strike = Math.round((100 + random() * 50) * 1e6) / 1e6;
      return {
        id: String(i),
        terms,
        premium: 0,
        opened: '2025-01-24',
        status: 'active' as const,
      };
    });
    const [r] = marginGroups(positions, 'cross');
    for (let sample = 0; sample < 200; sample++) {
      const spot = BigInt(Math.floor(random() * 200_000_000));
      // Independent integer oracle: truncate only after summing a contract's legs.
      const cash = positions.reduce((sum, p) => {
        const raw = p.terms.legs.reduce((n, l) => {
          const diff =
            l.kind === 'call' ? spot - units(l.strike) : units(l.strike) - spot;
          return (
            n +
            (diff > 0n ? diff : 0n) *
              units(p.terms.quantity) *
              BigInt(l.ratio) *
              (l.side === 'buy' ? 1n : -1n)
          );
        }, 0n);
        return sum + raw / 1_000_000n;
      }, 0n);
      assert.ok(
        cash >= -units(r.cash) && cash <= units(r.counterpartyCash),
        `${trial}:${sample}`,
      );
    }
  }
});

void test('vault: fractional cross collateral settles after all free cash is withdrawn at a real stored close', () => {
  const a = setup();
  try {
    a.deposit('USDC', 100);
    for (const [i, strike] of [150.165478, 155.431558, 156.349041].entries()) {
      const t = templateTerms('secured-put', '2025-02-11');
      t.quantity = 0.020402;
      t.settlement = 'cash';
      t.legs = [
        {
          kind: 'put',
          side: i === 0 ? 'buy' : 'sell',
          ratio: i === 0 ? 2 : 1,
          strike,
        },
      ];
      a.execute(t);
    }
    assert.equal(a.state.risk.cash, 0.233597);
    a.act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'withdraw',
      amount: a.state.risk.freeCash,
    });
    a.act({ type: 'advance', date: '2025-02-11' });
    assert.equal(a.state.market.price, 132.8);
    assert.equal(a.state.book.vault.USDC, 0.000001);
    assert.ok(a.state.book.options.every((p) => p.status === 'settled'));
    assert.equal(a.state.risk.cash, 0);
    validateLedger(a.state.book, totals(initialVault()));
  } finally {
    a.store.close();
  }
});
