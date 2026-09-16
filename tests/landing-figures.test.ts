import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES,
  HERO,
  HERO_CALL,
  OPEN_DATE,
  PREIPO_EXPIRY,
  SPOT,
  EXPIRY,
  dayLabel,
} from '../lib/oddlot/landing';
import { mark, expiries, VOLATILITY } from '../lib/oddlot/market';
import { orderGreeks, strategyPnl, days } from '../lib/oddlot/math';
import { termInterest } from '../lib/oddlot/funding';
import type { OrderTerms } from '../lib/oddlot/types';
import { EXERCISE_WINDOW_DAYS } from '../lib/preipo/terms';

/**
 * The landing page quotes prices. These assert the quotes are the desk's
 * own, so a copy edit cannot turn them back into invented numbers.
 */

const rows = (id: string) =>
  Object.fromEntries(EXAMPLES.find((e) => e.id === id)!.rows);

void test('the reference close is the stored one, not a literal', () => {
  assert.equal(SPOT, mark(OPEN_DATE));
  assert.equal(HERO.spotLabel, '$142.62');
});

void test('the expiry is a real session at least two weeks out', () => {
  assert.ok(expiries(OPEN_DATE).includes(EXPIRY));
  assert.ok(days(OPEN_DATE, EXPIRY) >= 14);
  assert.equal(HERO.dte, Math.round(days(OPEN_DATE, EXPIRY)));
});

void test('every example states when it ends', () => {
  for (const e of EXAMPLES)
    assert.ok(
      e.rows.some(([, v]) =>
        /^\d{2}\/\d{2}\/\d{4}$/.test(v.split(' · ').pop() as string),
      ),
      `${e.id} does not show an expiry`,
    );
});

void test('expiries are listed the way an options chain lists them', () => {
  assert.match(HERO.expiryLabel, /^\d{2}\/\d{2}\/\d{4}$/);
  for (const e of EXAMPLES)
    for (const [, v] of e.rows)
      assert.ok(!/\b\d+d\b/.test(v), `${e.id} still abbreviates a term: ${v}`);
});

void test('the pre-IPO expiry is one exercise window after the open', () => {
  assert.equal(
    Date.parse(`${PREIPO_EXPIRY}T12:00:00Z`) -
      Date.parse(`${OPEN_DATE}T12:00:00Z`),
    EXERCISE_WINDOW_DAYS * 86_400_000,
  );
  const rows = Object.fromEntries(
    EXAMPLES.find((e) => e.id === 'pre-ipo')!.rows,
  );
  assert.equal(rows['Escrow 0.25 T-OpenAI'], dayLabel(PREIPO_EXPIRY));
});

void test('the quoted single-call premium is what the engine prices', () => {
  const call: OrderTerms = {
    name: 'call',
    quantity: 1,
    expiry: EXPIRY,
    settlement: 'physical',
    reference: 'stock',
    legs: [{ kind: 'call', side: 'buy', strike: 145, ratio: 1 }],
  };
  const premium = orderGreeks(call, SPOT, OPEN_DATE, VOLATILITY).price;
  assert.equal(rows('options').Premium, `$${premium.toFixed(2)}`);
  assert.equal(
    rows('options')['Cash to fund exercise'],
    `$${(145 + premium).toFixed(2)}`,
  );
});

void test('the hero is a long call, whose upside does not stop', () => {
  const premium = orderGreeks(HERO_CALL, SPOT, OPEN_DATE, VOLATILITY).price;
  const stat = (k: string) => HERO.stats.find((s) => s.k === k)!.v;

  // A long call loses only the premium, however far the stock falls.
  assert.ok(
    Math.abs(strategyPnl(HERO_CALL, 95, SPOT, premium, 0) + premium) < 1e-6,
  );
  assert.equal(stat('Cost, and max loss'), `$${premium.toFixed(2)}`);
  assert.equal(stat('Break-even'), `$${(145 + premium).toFixed(2)}`);

  // And it keeps paying: no ceiling, at any price you care to name.
  const far = [195, 300, 1000].map((p) =>
    strategyPnl(HERO_CALL, p, SPOT, premium, 0),
  );
  for (let i = 1; i < far.length; i++) assert.ok(far[i] > far[i - 1]);
  assert.ok(Math.abs(far[2] - (1000 - 145 - premium)) < 1e-6);

  // So the card quotes no maximum, and no cap it does not have.
  assert.ok(!HERO.stats.some((s) => /max gain|most it can pay|cap/i.test(s.k)));

  // The drawn path has a point for every sample, inside the viewBox,
  // and rises from left to right.
  assert.equal(HERO.line.split('L').length, 81);
  const ys = [...HERO.line.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(
    ([, x, y]) => {
      assert.ok(Number(x) >= 0 && Number(x) <= 760);
      assert.ok(Number(y) >= 0 && Number(y) <= 240);
      return Number(y);
    },
  );
  assert.ok(ys.at(-1)! < ys[0]); // lower y is a higher payoff
});

void test('the spread keeps its cap, where the cap is the point', () => {
  const rows = Object.fromEntries(
    EXAMPLES.find((e) => e.id === 'structures')!.rows,
  );
  assert.ok('Upside capped above $160' in rows);
});

void test('the lending example uses the funding schedule', () => {
  assert.equal(
    rows('lending')['Borrower posts'],
    `$${(SPOT * 1.5).toFixed(2)}`,
  );
  const interest = termInterest(1, SPOT, OPEN_DATE, EXPIRY);
  assert.ok(
    rows('lending')['Interest prepaid'].startsWith(`$${interest.toFixed(4)}`),
  );
});
