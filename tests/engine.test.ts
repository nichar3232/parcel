import assert from 'node:assert/strict';
import { test } from 'node:test';
import history from '../data/history.json';
import {
  conservation,
  initialBook,
  maximum,
  payout,
  transition,
  units,
  validate,
  type Book,
  type Terms,
} from '../lib/engine';
const base: Terms = {
  kind: 'put',
  low: 80,
  high: 100,
  quantity: 1,
  premium: 4,
  expiry: '2025-01-27',
  scenario: 'deepseek',
};
function funded() {
  const b = transition(initialBook(), {
    type: 'request',
    id: 'x',
    terms: base,
    now: 1,
  });
  return transition(b, { type: 'fund', id: 'x', premium: 4, now: 2 });
}
function active() {
  return transition(funded(), { type: 'accept', id: 'x', now: 3 });
}
const settle = (b: Book, price = 118.42, available = true) =>
  transition(b, {
    type: 'settle',
    id: 'x',
    price,
    date: '2025-01-27',
    available,
    now: 5,
  });
void test('worked put-spread examples match independently specified economics', () => {
  for (const [s, p, n, combined] of [
    [120, 0, -4, 16],
    [100, 0, -4, -4],
    [90, 10, 6, -4],
    [80, 20, 16, -4],
    [60, 20, 16, -24],
  ]) {
    assert.equal(payout(base, s), p);
    assert.equal(payout(base, s) - 4, n);
    assert.equal(s - 100 + payout(base, s) - 4, combined);
  }
});
void test('worked capped call examples', () => {
  const t = { ...base, kind: 'call' as const, low: 100, high: 120, premium: 5 };
  for (const [s, p] of [
    [90, 0],
    [110, 10],
    [130, 20],
  ])
    assert.equal(payout(t, s), p);
});
void test('10000 property samples: independent option legs, bounds and allocation conservation', () => {
  let seed = 87123;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < 10000; i++) {
    const low = Math.round((1 + rand() * 900) * 100) / 100,
      high = low + 1 + Math.floor(rand() * 100),
      quantity = (1 + Math.floor(rand() * 1000000)) / 1e6,
      s = Math.round(rand() * 1200 * 1e6) / 1e6;
    for (const kind of ['put', 'call'] as const) {
      const t = { ...base, kind, low, high, quantity, premium: 0 };
      const leg =
        kind === 'put'
          ? Math.max(high - s, 0) - Math.max(low - s, 0)
          : Math.max(s - low, 0) - Math.max(s - high, 0);
      const got = payout(t, s),
        reserve = maximum(t);
      assert.ok(Math.abs(got - leg * quantity) < 0.00000101);
      assert.ok(got >= 0 && got <= reserve);
      assert.equal(units(got) + units(reserve - got), units(reserve));
    }
  }
});
void test('fractional quantity and rounding at strike boundaries', () => {
  const t = { ...base, quantity: 0.125, premium: 0 };
  assert.equal(payout(t, 90), 1.25);
  assert.equal(payout({ ...t, quantity: 0.333333 }, 99.999999), 0);
  for (const s of [
    0, 79.999999, 80, 80.000001, 99.999999, 100, 100.000001, 1e9,
  ])
    assert.ok(payout(t, s) <= 2.5);
});
void test('rejects invalid terms, nonfinite inputs and excess precision', () => {
  for (const edit of [
    { low: 100 },
    { high: 79 },
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1001 },
    { quantity: 0.0000001 },
    { premium: 21 },
    { premium: NaN },
    { high: Infinity },
    { kind: 'barrier' },
  ])
    assert.throws(() => validate({ ...base, ...edit } as Terms));
  assert.throws(() => units(-1));
});
void test('funding reserves once and atomic acceptance transfers only premium', () => {
  const b = funded();
  assert.equal(b.makerCash, 49980);
  assert.equal(conservation(b), 60000);
  const a = transition(b, { type: 'accept', id: 'x', now: 3 });
  assert.equal(a.holderCash, 9996);
  assert.equal(a.makerCash, 49984);
  assert.equal(conservation(a), 60000);
  assert.throws(() => transition(a, { type: 'accept', id: 'x', now: 4 }));
  assert.throws(() => transition(a, { type: 'cancel', id: 'x', now: 4 }));
});
void test('expired acceptance fails without mutating balances; reserve is reclaimable', () => {
  const b = funded(),
    before = JSON.stringify(b);
  assert.throws(
    () => transition(b, { type: 'accept', id: 'x', now: 120002 }),
    /expired/,
  );
  assert.equal(JSON.stringify(b), before);
  const c = transition(b, { type: 'expire', id: 'x', now: 120002 });
  assert.equal(c.makerCash, 50000);
  assert.equal(c.holderCash, 10000);
  assert.equal(conservation(c), 60000);
});
void test('missing data keeps reserve locked; recovery and keeper retry are idempotent', () => {
  const a = active();
  const delayed = settle(a, 118.42, false);
  assert.equal(delayed.positions[0].status, 'awaiting');
  assert.equal(conservation(delayed), 60000);
  const s = settle(delayed);
  assert.equal(s.positions[0].status, 'settled');
  assert.deepEqual(settle(s, 0), s);
});
void test('claims distribute every unit once and close only after both claims', () => {
  const s = settle(active());
  const holder = transition(s, {
    type: 'claim',
    id: 'x',
    party: 'holder',
    now: 6,
  });
  assert.equal(holder.positions[0].status, 'settled');
  assert.throws(() =>
    transition(holder, { type: 'claim', id: 'x', party: 'holder', now: 7 }),
  );
  const both = transition(holder, {
    type: 'claim',
    id: 'x',
    party: 'maker',
    now: 8,
  });
  assert.equal(both.positions[0].status, 'closed');
  assert.equal(conservation(both), 60000);
  assert.throws(() =>
    transition(both, { type: 'claim', id: 'x', party: 'maker', now: 9 }),
  );
});
void test('insufficient funds and duplicate IDs cannot corrupt the book', () => {
  const b = initialBook();
  b.makerCash = 1;
  const r = transition(b, { type: 'request', id: 'x', terms: base, now: 1 });
  assert.throws(() =>
    transition(r, { type: 'fund', id: 'x', premium: 4, now: 2 }),
  );
  assert.equal(r.makerCash, 1);
  assert.throws(() =>
    transition(r, { type: 'request', id: 'x', terms: base, now: 3 }),
  );
  const f = funded();
  f.holderCash = 0;
  assert.throws(() => transition(f, { type: 'accept', id: 'x', now: 3 }));
  assert.equal(f.positions[0].status, 'funded');
});
void test('historical snapshot is monotonic, complete OHLC, excludes non-sessions', () => {
  let prior = '';
  assert.equal(history.rows.length, 63);
  for (const r of history.rows) {
    assert.ok(r.date > prior);
    prior = r.date;
    assert.ok(
      r.high >= r.low && r.high >= r.close && r.low <= r.close && r.volume > 0,
    );
  }
  assert.equal(
    history.rows.find((r) => r.date === '2025-01-27')?.close,
    118.42,
  );
  assert.equal(
    history.rows.some((r) => r.date === '2025-01-20'),
    false,
  );
});
void test('three historical scenarios produce exact distinct payouts', () => {
  const cases = [
    {
      date: '2025-01-27',
      kind: 'put',
      low: 120,
      high: 140,
      premium: 400,
      payout: 2000,
    },
    {
      date: '2025-02-27',
      kind: 'put',
      low: 115,
      high: 130,
      premium: 350,
      payout: 985,
    },
    {
      date: '2025-01-22',
      kind: 'call',
      low: 130,
      high: 145,
      premium: 500,
      payout: 1500,
    },
  ];
  for (const t of cases) {
    assert.equal(
      payout(
        { ...base, ...t, kind: t.kind as 'put' | 'call', quantity: 100 },
        history.rows.find((r) => r.date === t.date)!.close,
      ),
      t.payout,
    );
  }
});

void test('caller cannot choose a favorable historical sample', () => {
  assert.throws(() => settle(active(), 90), /committed/);
  assert.throws(
    () => validate({ ...base, expiry: '2025-01-20' }),
    /historical/,
  );
});
