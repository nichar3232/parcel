import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService } from '../server/parcel/service';
import { totals } from '../server/parcel/ledger';
import { mark, selectableExpiries } from '../lib/parcel/market';
import type { OrderTerms, VaultAction } from '../lib/parcel/types';

/**
 * A pre-IPO covered call is a vault contract like any other.
 *
 * The Pre-IPO ticket writes through the same quote and execute road as
 * the NVDA desk, so what these tests pin down is that the road holds
 * for a sponsor token: the premium is the engine's, the tokens are
 * reserved, and expiry settles on the token's own committed close in
 * whichever direction it went.
 */
const SYMBOL = 'T-OpenAI';

function setup() {
  const store = new Store(':memory:'),
    { session } = store.createSession();
  const now = 1800000000000;
  const service = new VaultService(store, () => now);
  let state = service.snapshot(session);
  const act = (action: VaultAction) =>
    (state = service.apply(session, randomUUID(), {
      revision: state.revision,
      action,
    }));
  const quote = (terms: OrderTerms) =>
    service.quote(session, randomUUID(), { revision: state.revision, terms });
  return {
    store,
    act,
    quote,
    get state() {
      return state;
    },
  };
}

const coveredCall = (
  quantity: number,
  strike: number,
  expiry: string,
): OrderTerms => ({
  symbol: SYMBOL,
  name: 'OpenAI covered call',
  quantity,
  expiry,
  settlement: 'physical',
  reference: 'stock',
  legs: [{ kind: 'call', side: 'sell', strike, ratio: 1 }],
});

const near = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} is not ${b}`);

void test('pre-ipo: a covered call on a sponsor token needs the tokens in the vault', () => {
  const a = setup();
  try {
    const expiry = selectableExpiries(a.state.book.date).find(
      (d) => !d.includes('T'),
    )!;
    const q = a.quote(coveredCall(0.25, 900, expiry));
    assert.equal(q.eligible, false);
    assert.match(q.reason ?? '', /T-OpenAI/);
    assert.throws(() => a.act({ type: 'execute', quoteId: q.id }), /T-OpenAI/);
  } finally {
    a.store.close();
  }
});

void test('pre-ipo: writing reserves the tokens and pays the engine premium into the vault', () => {
  const a = setup();
  try {
    const before = totals(a.state.book);
    a.act({
      type: 'transfer',
      direction: 'deposit',
      asset: SYMBOL,
      amount: 0.25,
    });
    const expiry = selectableExpiries(a.state.book.date).find(
      (d) => !d.includes('T'),
    )!;
    const q = a.quote(coveredCall(0.25, 900, expiry));
    assert.equal(q.eligible, true, q.reason);
    assert.ok(q.premium < 0, 'the writer is paid');
    assert.equal(q.terms.symbol, SYMBOL);
    near(q.sharesRequired, 0.25);
    near(q.sharesAfter, 0);
    a.act({ type: 'execute', quoteId: q.id });
    const p = a.state.book.options[0];
    assert.equal(p.terms.symbol, SYMBOL);
    assert.equal(p.status, 'active');
    near(a.state.book.vault.USDC, -q.premium);
    near(a.state.book.vault[SYMBOL], 0.25);
    near(a.state.risk.freeShares[SYMBOL], 0);
    assert.deepEqual(totals(a.state.book), before);
  } finally {
    a.store.close();
  }
});

void test('pre-ipo: expiry settles on the token’s committed close, either way it goes', () => {
  for (const side of ['called', 'expired'] as const) {
    const a = setup();
    try {
      a.act({
        type: 'transfer',
        direction: 'deposit',
        asset: SYMBOL,
        amount: 0.25,
      });
      const expiry = selectableExpiries(a.state.book.date).find(
        (d) => !d.includes('T'),
      )!;
      const close = mark(SYMBOL, expiry);
      // A strike the close is sure to be past, or sure to be short of.
      const strike = side === 'called' ? close * 0.9 : close * 1.1;
      const q = a.quote(coveredCall(0.25, strike, expiry));
      assert.equal(q.eligible, true, q.reason);
      a.act({ type: 'execute', quoteId: q.id });
      const before = totals(a.state.book);
      a.act({ type: 'advance', date: expiry });
      const p = a.state.book.options[0];
      assert.equal(p.status, 'settled');
      if (side === 'called') {
        near(a.state.book.vault[SYMBOL], 0, 'tokens delivered');
        near(a.state.book.vault.USDC, -q.premium + 0.25 * strike);
      } else {
        near(a.state.book.vault[SYMBOL], 0.25, 'tokens returned');
        near(a.state.book.vault.USDC, -q.premium);
      }
      near(a.state.risk.freeShares[SYMBOL], a.state.book.vault[SYMBOL]);
      assert.deepEqual(totals(a.state.book), before);
    } finally {
      a.store.close();
    }
  }
});
