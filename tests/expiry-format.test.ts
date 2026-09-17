import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryLabel } from '../lib/parcel/format';

void test('a dated expiry lists as mm/dd/yyyy', () => {
  assert.equal(expiryLabel('2025-02-07'), '02/07/2025');
  assert.equal(expiryLabel('2025-01-31'), '01/31/2025');
});

void test('the calendar day does not shift across time zones', () => {
  // A bare date parsed as local midnight lands on the previous day west
  // of UTC, which would misprint every expiry in the Americas.
  assert.equal(expiryLabel('2025-03-01'), '03/01/2025');
});

void test('intraday expiries keep the hour that distinguishes them', () => {
  const hours = ['01:00', '03:00', '22:00'].map((h) =>
    expiryLabel(`2025-01-24T${h}:00Z`),
  );
  assert.deepEqual(hours, [
    '01/24/2025 · 01:00 UTC',
    '01/24/2025 · 03:00 UTC',
    '01/24/2025 · 22:00 UTC',
  ]);
  // The desk lists several on one day; they must not read alike.
  assert.equal(new Set(hours).size, hours.length);
});
