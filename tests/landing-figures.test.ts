import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, HERO, OPEN_DATE, SPOT, EXPIRY } from '../lib/oddlot/landing';
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
      e.rows.some(
        ([, v]) => v.includes(HERO.expiryLabel) || /\b\d+d\b/.test(v),
      ),
      `${e.id} does not show an expiry`,
    );
});

void test('the pre-IPO window is the one the contract is built with', () => {
  const escrow = Object.fromEntries(
    EXAMPLES.find((e) => e.id === 'pre-ipo')!.rows,
  ).Escrow;
  assert.ok(escrow.endsWith(`· ${EXERCISE_WINDOW_DAYS}d`));
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

void test('the hero payoff is computed, and its max gain matches the card', () => {
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
  assert.equal(
    HERO.stats.find((s) => s.k === 'Max gain')!.v,
    `$${best.toFixed(2)}`,
  );
  assert.equal(
    HERO.stats.find((s) => s.k === 'Premium')!.v,
    `$${premium.toFixed(2)}`,
  );
  // A debit spread cannot lose more than it cost.
  assert.ok(Math.abs(worst + premium) < 1e-6);
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
