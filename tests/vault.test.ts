import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService } from '../server/oddlot/service';
import { initialVault, totals, validateLedger } from '../server/oddlot/ledger';
import {
  cashPayoff,
  deliveries,
  optionGreeks,
  orderGreeks,
} from '../lib/oddlot/math';
import { marginGroups } from '../lib/oddlot/risk';
import { templateTerms, templates } from '../lib/oddlot/templates';
import type { OrderTerms, VaultAction } from '../lib/oddlot/types';
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
    assert.deepEqual(a.state.book.wallet, { USDC: 10000, NVDA: 25 });
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
    assert.equal(a.state.risk.shares, 0.333333);
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
    assert.equal(a.state.risk.shares, 0);
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
    assert.equal(a.state.risk.shares, 0);
    assert.equal(a.state.risk.releasedValue, 10);
    a.act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'USDC',
      amount: a.state.book.vault.USDC,
    });
    assert.throws(
      () => a.act({ type: 'close-option', id: p.id }),
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
    assert.equal(a.state.risk.counterpartyShares, 1);
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
    assert.equal(a.state.risk.counterpartyShares, 0);
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
      assert.equal(a.state.risk.shares, 0);
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
        d.cash >= -r.cash - 0.000001 && d.cash <= r.counterpartyCash + 0.000001,
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
