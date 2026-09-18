import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  initialVault,
  addOrder,
  premium,
  setMarketDate,
  totals,
  closeOrder,
  validateLedger,
} from '../server/oddlot/ledger';
import { optionsChain, sizeOrder } from '../server/oddlot/catalog';
import { templateTerms } from '../lib/oddlot/templates';
import { cashPayoff, orderGreeks, add, signedUnits } from '../lib/oddlot/math';
import { curveCash, curveCap } from '../lib/oddlot/curves';
import { deliveryBounds } from '../lib/oddlot/envelope';
import { parseOrderTerms } from '../lib/oddlot/validation';
import { risk } from '../lib/oddlot/risk';
import { mark, clockRows, shortExpiries } from '../lib/oddlot/market';
import { termInterest, accruedInterest } from '../lib/oddlot/funding';
import type { OrderTerms, OptionPosition } from '../lib/oddlot/types';
const position = (terms: OrderTerms): OptionPosition => ({
  id: randomUUID(),
  terms,
  premium: 0,
  opened: '2025-01-24',
  status: 'active',
});
const inverse = (terms: OrderTerms): OrderTerms => ({
  ...terms,
  ...(terms.curve
    ? {
        curve: {
          ...terms.curve,
          side: terms.curve.side === 'buy' ? 'sell' : 'buy',
        },
      }
    : {}),
  legs: terms.legs.map((l) => ({
    ...l,
    side: l.side === 'buy' ? 'sell' : 'buy',
  })),
});
function funded() {
  const b = initialVault();
  b.wallet.USDC -= 1000;
  b.vault.USDC = 1000;
  return b;
}

void test('curves: independent quadratic and exponential values, both directions, capped tails and exact inverse truncation', () => {
  for (const id of ['quadratic', 'exponential']) {
    const t = templateTerms(id, '2025-02-07');
    t.quantity = 0.333333;
    assert.equal(curveCash(t, 130), 0n);
    assert.equal(curveCash(t, 160), 3_333_330n);
    assert.equal(curveCash(t, 10000), 3_333_330n);
    const expected = id === 'quadratic' ? 0.25 : Math.expm1(2) / Math.expm1(4);
    assert.equal(curveCash(t, 145), BigInt(Math.floor(3_333_330 * expected)));
    let previous = 0n;
    for (let p = 0; p <= 200; p += 0.125) {
      const v = curveCash(t, p);
      assert.ok(v >= previous && v <= curveCap(t));
      previous = v;
      assert.equal(v + curveCash(inverse(t), p), 0n);
    }
    t.curve!.direction = 'down';
    assert.equal(curveCash(t, 0), 3_333_330n);
    assert.equal(curveCash(t, 160), 0n);
  }
});
void test('curves: rejects malformed, mixed, unbounded, zero-payable and wrong dividend events', () => {
  const t = templateTerms('quadratic', '2025-02-07');
  for (const patch of [
    { cap: 0 },
    { cap: NaN },
    { upper: 130 },
    { lower: -1 },
    { shape: 'linear' },
    { side: 'hold' },
    { direction: 'both' },
  ])
    assert.throws(() =>
      parseOrderTerms({ ...t, curve: { ...t.curve, ...patch } }, '2025-01-24'),
    );
  assert.throws(
    () =>
      parseOrderTerms(
        { ...t, quantity: 0.000001, curve: { ...t.curve, cap: 0.000001 } },
        '2025-01-24',
      ),
    /no payable/,
  );
  assert.throws(
    () =>
      parseOrderTerms(
        { ...t, legs: templateTerms('call', t.expiry).legs },
        '2025-01-24',
      ),
    /cannot contain/,
  );
  assert.throws(
    () => parseOrderTerms({ ...t, reference: 'dividend' }, '2025-01-24'),
    /March 12/,
  );
  const parsed = parseOrderTerms(
    templateTerms('dividend-curve', '2025-02-07'),
    '2025-01-24',
  );
  assert.equal(cashPayoff(parsed, 0.01), 0.0025);
});
void test('nonlinear reserve nets identical inverses only and remains conservative across shapes and quantities', () => {
  const t = templateTerms('quadratic', '2025-02-07');
  t.quantity = 0.333333;
  assert.deepEqual(deliveryBounds([t, inverse(t)]), {
    cashMin: 0n,
    cashMax: 0n,
    sharesMin: 0n,
    sharesMax: 0n,
  });
  const other = inverse(templateTerms('exponential', t.expiry));
  const bounds = deliveryBounds([t, other]);
  for (let p = 0; p < 300; p += 0.125) {
    const payout = signedUnits(add(cashPayoff(t, p), cashPayoff(other, p)));
    assert.ok(payout >= bounds.cashMin && payout <= bounds.cashMax);
  }
  assert.equal(bounds.cashMin, -10_000_000n);
});
void test('calendar margin uses an earlier guaranteed box receipt; withdrawal and multi-date settlement remain solvent', () => {
  const b = funded(),
    original = totals(b);
  const box = templateTerms('box', '2025-01-27'),
    later = inverse(templateTerms('call-spread', '2025-02-07'));
  addOrder(b, box, premium(box, b));
  addOrder(b, later, premium(later, b));
  assert.equal(risk(b).cash, 0);
  assert.equal(risk(b).grossCash, 10);
  b.wallet.USDC = add(b.wallet.USDC, b.vault.USDC);
  b.vault.USDC = 0;
  validateLedger(b, original);
  assert.throws(
    () =>
      closeOrder(
        structuredClone(b),
        b.options.find((p) => p.terms.name === box.name)!.id,
        0,
      ),
    /short of/,
  );
  setMarketDate(b, '2025-02-07');
  validateLedger(b, original);
  assert.equal(b.options.filter((p) => p.status === 'active').length, 0);
});
void test('a future box cannot finance an earlier obligation; unrelated calendar spreads get no assumed hedge credit', () => {
  const b = funded();
  b.options = [
    position(inverse(templateTerms('call-spread', '2025-01-27'))),
    position(templateTerms('box', '2025-02-07')),
  ];
  assert.equal(risk(b).cash, 10);
  b.options[1] = position(templateTerms('call-spread', '2025-02-07'));
  assert.equal(risk(b).cash, 10);
  b.margin = 'isolated';
  assert.equal(risk(b).cash, 10);
});
void test('calendar reserves cover every intermediate prefix under independent price paths', () => {
  let seed = 721;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const dates = ['2025-01-27', '2025-01-28', '2025-02-07'];
  for (let run = 0; run < 100; run++) {
    const b = funded();
    for (let i = 0; i < 12; i++) {
      let t = templateTerms(
        ['box', 'call-spread', 'put-spread', 'quadratic', 'exponential'][
          Math.floor(random() * 5)
        ],
        dates[i % 3],
      );
      t.quantity = Math.floor(random() * 1e6 + 1) / 1e6;
      if (random() < 0.5) t = inverse(t);
      b.options.push(position(t));
    }
    const r = risk(b);
    let cash = signedUnits(r.cash),
      cp = signedUnits(r.counterpartyCash);
    for (const date of dates) {
      const price = Math.floor(random() * 300_000_000) / 1e6;
      const payoff = b.options
        .filter((p) => p.terms.expiry === date)
        .reduce((sum, p) => sum + signedUnits(cashPayoff(p.terms, price)), 0n);
      cash += payoff;
      cp -= payoff;
      assert.ok(cash >= 0n && cp >= 0n, `insolvent prefix ${run} ${date}`);
    }
  }
});
void test('hourly expiries advance without look-ahead and settle at their exact committed clock observation', () => {
  const b = funded(),
    original = totals(b);
  const hourly = '2025-01-24T01:00:00Z';
  assert.ok(shortExpiries(b.date).includes(hourly));
  assert.equal(mark('NVDA', hourly), 142.62);
  const t = templateTerms('quadratic', hourly);
  parseOrderTerms(t, b.date);
  addOrder(b, t, premium(t, b));
  setMarketDate(b, '2025-01-27');
  assert.equal(b.options[0].cashFlow, cashPayoff(t, 142.62));
  assert.notEqual(b.options[0].cashFlow, cashPayoff(t, mark('NVDA', b.date)));
  validateLedger(b, original);
  assert.throws(() => parseOrderTerms(t, b.date), /future/);
  assert.throws(() => mark('NVDA', '2025-01-24T01:30:00Z'));
  assert.equal(
    termInterest(1, 142.62, '2025-01-24', hourly),
    Math.round(((142.62 * 0.035) / 8760) * 1e6) / 1e6,
  );
  assert.equal(
    accruedInterest(
      0.00057,
      '2025-01-24',
      '2025-01-24T04:00:00Z',
      '2025-01-24T02:00:00Z',
    ),
    0.000285,
  );
  assert.equal(new Set(clockRows.map((r) => r.date)).size, clockRows.length);
});
void test('chain indications match executable model premiums and expose physical exercise backing even with an empty vault', () => {
  const b = initialVault(),
    chain = optionsChain(b, '2025-02-07', 0.333333);
  // The ladder is not evenly spaced: it lists real listed increments,
  // dense around the money and thinning out, so asserting a row count
  // would only pin today's spot. Assert the shape instead.
  const strikes = chain.rows.map((r) => r.strike);
  assert.ok(strikes.length > 15);
  assert.deepEqual(strikes, [...strikes].sort((a, b) => a - b));
  assert.equal(new Set(strikes).size, strikes.length);
  assert.ok(strikes[0] < chain.spot && strikes.at(-1)! > chain.spot);
  // Half-steps exist, and only inside the dense band around spot.
  const half = strikes.filter((k) => k % 5 !== 0);
  assert.ok(half.length > 0);
  for (const k of half) assert.ok(Math.abs(k / chain.spot - 1) < 0.12);
  const call = chain.rows.find((r) => r.strike === 145)!.contracts[0];
  assert.equal(call.buy.cash, 48.333285);
  assert.equal(call.sell.shares, 0.333333);
  const t = templateTerms('call', '2025-02-07');
  t.quantity = 0.333333;
  assert.equal(call.buy.premium, premium(t, b));
  assert.equal(call.sell.premium, -call.buy.premium);
  assert.throws(() => optionsChain(b, '2025-02-07', 0.3333333));
});
void test('server sizing respects actual rounded premium budgets, sensitivity targets and quantity limits', () => {
  const b = initialVault();
  for (const id of [
    'call',
    'call-spread',
    'quadratic',
    'exponential',
    'dividend',
  ]) {
    const t = templateTerms(id, '2025-02-07');
    const r = sizeOrder(b, t, 'premium', 0.3);
    assert.ok(
      r.premium <= 0.3 && r.terms.quantity > 0 && r.terms.quantity <= 1000,
    );
    if (r.terms.quantity < 1000)
      assert.ok(
        premium({ ...r.terms, quantity: add(r.terms.quantity, 0.000001) }, b) >
          0.3,
      );
  }
  const t = templateTerms('call', '2025-02-07'),
    r = sizeOrder(b, t, 'sensitivity', 0.001);
  assert.ok(Math.abs(r.centSensitivity) <= 0.001);
  assert.ok(r.cashFunding > r.premium);
  assert.throws(
    () => sizeOrder(b, inverse(t), 'premium', 1),
    /positive premium/,
  );
  assert.throws(() => sizeOrder(b, t, 'exposure', 0.3333333));
  assert.ok(
    Math.abs(orderGreeks(t, mark('NVDA', b.date), b.date).theta) >
      Math.abs(
        orderGreeks({ ...t, quantity: 0.1 }, mark('NVDA', b.date), b.date).theta,
      ),
  );
});
void test('500 nonlinear positions retain bounded risk calculation cost', () => {
  const b = funded();
  for (let i = 0; i < 500; i++) {
    const t = templateTerms('exponential', '2025-02-07');
    t.quantity = (i + 1) / 1e6;
    b.options.push(position(t));
  }
  const start = performance.now();
  risk(b);
  assert.ok(performance.now() - start < 500);
});
