import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  actionBytes,
  bookBytes,
  bookHash,
  ONCHAIN_ACTIONS,
  terms,
} from '../server/parcel/chain/codec';
import {
  addOrder,
  closeOrder,
  initialVault,
  premium,
} from '../server/parcel/ledger';
import { templateTerms } from '../lib/parcel/templates';
import { signedUnits } from '../lib/parcel/math';
import type { VaultPlan } from '../server/parcel/service';

void test('codec: book hash is stable for identical books and moves when balances change', () => {
  const a = initialVault();
  const b = initialVault();
  assert.ok(bookBytes(a).equals(bookBytes(b)));
  assert.ok(bookHash(a).equals(bookHash(b)));
  b.vault.USDC = 1;
  assert.equal(bookBytes(a).equals(bookBytes(b)), false);
  assert.equal(bookHash(a).equals(bookHash(b)), false);
});

void test('codec: open and close action premiums match ledger cash polarity', () => {
  const before = initialVault();
  before.vault.USDC = 1_000;
  before.counterparty.USDC = 1_000;
  const t = templateTerms('call-spread', '2025-02-07');
  t.quantity = 0.5;
  const cost = premium(t, before);
  const afterOpen = structuredClone(before);
  const id = addOrder(afterOpen, t, cost, randomUUID());
  const openPlan: VaultPlan = {
    before,
    book: afterOpen,
    revision: 0,
    action: { type: 'execute', quoteId: 'q' },
    hash: 'h',
  };
  // A replay action carries no clock: the `Option<Tick>` is None (0).
  const openBytes = actionBytes(openPlan).subarray(1);
  assert.equal(actionBytes(openPlan)[0], 0, 'no tick on the replay');
  assert.equal(openBytes[0], 2, 'Open discriminant');
  const openPremium = openBytes.readBigInt64LE(1 + 16 + terms(t).length);
  assert.equal(openPremium, signedUnits(cost));
  assert.ok(openPremium > 0n, 'buyer pays a positive open premium');

  const afterClose = structuredClone(afterOpen);
  closeOrder(afterClose, id, cost);
  const closePlan: VaultPlan = {
    before: afterOpen,
    book: afterClose,
    revision: 1,
    action: { type: 'execute', quoteId: 'q2' },
    hash: 'h2',
  };
  const closeBytes = actionBytes(closePlan).subarray(1);
  assert.equal(closeBytes[0], 3, 'Close discriminant');
  const closePremium = closeBytes.readBigInt64LE(1 + 16);
  // Program Close premium is cash paid by the vault; a long close credits
  // the vault, so the encoded premium is negative.
  assert.equal(closePremium, -signedUnits(cost));
  assert.ok(closePremium < 0n);
});

void test('codec: unsupported actions stay off the onchain set; borrow and repay are encoded', () => {
  assert.ok(ONCHAIN_ACTIONS.has('execute'));
  assert.ok(ONCHAIN_ACTIONS.has('transfer'));
  assert.ok(ONCHAIN_ACTIONS.has('borrow'));
  assert.ok(ONCHAIN_ACTIONS.has('repay'));
  assert.equal(ONCHAIN_ACTIONS.has('close-option'), false);
  assert.equal(ONCHAIN_ACTIONS.has('not-a-real-action'), false);
});
