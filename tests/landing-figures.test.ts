import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES,
  HERO,
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
        /^[A-Z][a-z]{2} \d{1,2} '\d{2}$/.test(v.split(' · ').pop() as string),
      ),
      `${e.id} does not show an expiry`,
    );
});

void test('expiries are written the way an options chain writes them', () => {
  assert.match(HERO.expiryLabel, /^[A-Z][a-z]{2} \d{1,2} '\d{2}$/);
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

void test('the hero card leads with the risk, not the best case', () => {
  const spread: OrderTerms = {
    name: 'NVDA call spread',
    quantity: 0.25,
    expiry: EXPIRY,
    settlement: 'cash',
    reference: 'stock',
    legs: [
      { kind: 'call', side: 'buy', strike: 145, ratio: 1 },
      { kind: 'call', side: 'sell', strike: 160, ratio: 1 },
    ],
  };
  const premium = orderGreeks(spread, SPOT, OPEN_DATE, VOLATILITY).price;
  const best = strategyPnl(spread, 195, SPOT, premium, 0);
  const worst = strategyPnl(spread, 95, SPOT, premium, 0);
  const stat = (k: string) => HERO.stats.find((s) => s.k === k)!.v;
  // A debit spread cannot lose more than it cost, and the card says so.
  assert.ok(Math.abs(worst + premium) < 1e-6);
  assert.equal(stat('Cost, and max loss'), `$${premium.toFixed(2)}`);
  assert.equal(
    stat('Break-even'),
    `$${(145 + premium / spread.quantity).toFixed(2)}`,
  );
  // The best case on any debit spread is a multiple of the premium, so
  // it is not what the card leads with.
  assert.ok(best > premium * 3);
  assert.ok(!HERO.stats.some((s) => /max gain|most it can pay/i.test(s.k)));
  // The drawn path has a point for every sample, inside the viewBox.
  assert.equal(HERO.line.split('L').length, 81);
  for (const [, x, y] of HERO.line.matchAll(/[ML]([\d.]+),([\d.]+)/g)) {
    assert.ok(Number(x) >= 0 && Number(x) <= 760);
    assert.ok(Number(y) >= 0 && Number(y) <= 240);
  }
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
