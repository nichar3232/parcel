import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService } from '../server/parcel/service';
import { VaultChainCoordinator } from '../server/parcel/chain/coordinator';
import type {
  PreparedVaultTransaction,
  VaultChainAdapter,
} from '../server/parcel/chain/adapter';
import { tradedPremium, initialVault } from '../server/parcel/ledger';
import { templateTerms } from '../lib/parcel/templates';
import type { VaultBook } from '../lib/parcel/types';
import type { VaultPlan } from '../server/parcel/service';
import { bookBytes } from '../server/parcel/chain/codec';

void test('sandbox tracking: execute receipt premium matches quote, revision bumps once, no double-exec', () => {
  const store = new Store(':memory:');
  try {
    const session = store.createSession().session,
      service = new VaultService(store);
    const deposited = service.apply(session, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1000,
      },
    });
    assert.equal(deposited.revision, 1);
    const depositRow = store.mutations(session.id).find(
      (r) => r.action_type === 'transfer',
    );
    assert.ok(depositRow);
    assert.equal(depositRow!.revision_before, 0);
    assert.equal(depositRow!.revision_after, 1);
    assert.equal(depositRow!.mode, 'sandbox');
    assert.equal(depositRow!.premium, null);

    const terms = templateTerms('call-spread', '2025-02-07');
    const quote = service.quote(session, randomUUID(), {
      revision: 1,
      terms,
    });
    assert.equal(quote.premium, tradedPremium(terms, deposited.book));
    assert.equal(quote.eligible, true, quote.reason);

    const key = randomUUID(),
      body = { revision: 1, action: { type: 'execute', quoteId: quote.id } };
    const filled = service.apply(session, key, body);
    assert.equal(filled.revision, 2);
    assert.equal(filled.book.options[0].premium, quote.premium);
    assert.equal(
      filled.book.events[0].title,
      'Contract opened',
      'activity feed records the fill',
    );
    assert.equal(filled.book.events[0].cash, -quote.premium);

    const mutation = store
      .mutations(session.id)
      .find((r) => r.key === key)!;
    assert.equal(mutation.action_type, 'execute');
    assert.equal(mutation.quote_id, quote.id);
    assert.equal(mutation.premium, quote.premium);
    assert.equal(mutation.revision_before, 1);
    assert.equal(mutation.revision_after, 2);
    assert.equal(mutation.mode, 'sandbox');
    assert.equal(
      store.db
        .prepare('SELECT consumed FROM vault_quotes WHERE id=?')
        .get(quote.id)!.consumed,
      1,
    );

    assert.deepEqual(service.apply(session, key, body), filled);
    assert.equal(
      store.mutations(session.id).filter((r) => r.key === key).length,
      1,
      'idempotent retry does not insert a second mutation',
    );
    assert.throws(
      () =>
        service.apply(session, randomUUID(), {
          revision: 2,
          action: { type: 'execute', quoteId: quote.id },
        }),
      /already executed/,
    );
    assert.equal(service.snapshot(session).revision, 2);
    assert.equal(service.snapshot(session).book.options.length, 1);
  } finally {
    store.close();
  }
});

void test('sandbox tracking: lend, short and borrow each leave durable mutations and activity events', () => {
  const store = new Store(':memory:');
  try {
    const session = store.createSession().session,
      service = new VaultService(store);
    let state = service.apply(session, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'NVDA',
        direction: 'deposit',
        amount: 10,
      },
    });
    state = service.apply(session, randomUUID(), {
      revision: state.revision,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 5000,
      },
    });

    const lendKey = randomUUID();
    state = service.apply(session, lendKey, {
      revision: state.revision,
      action: { type: 'lend', quantity: 2, expiry: '2025-02-07', symbol: 'NVDA' },
    });
    assert.equal(state.book.loans[0].status, 'active');
    assert.ok(state.book.events.some((e) => e.title === 'Stock loan funded'));
    const lend = store.mutations(session.id).find((r) => r.key === lendKey)!;
    assert.equal(lend.action_type, 'lend');
    assert.equal(lend.revision_after, state.revision);

    const shortKey = randomUUID();
    state = service.apply(session, shortKey, {
      revision: state.revision,
      action: {
        type: 'short',
        quantity: 1,
        cap: 160,
        expiry: '2025-02-07',
        symbol: 'NVDA',
      },
    });
    assert.equal(state.book.shorts[0].status, 'active');
    assert.ok(
      state.book.events.some((e) => e.title === 'Protected short opened'),
    );
    assert.equal(
      store.mutations(session.id).find((r) => r.key === shortKey)!.action_type,
      'short',
    );

    const borrowKey = randomUUID();
    state = service.apply(session, borrowKey, {
      revision: state.revision,
      action: {
        type: 'borrow',
        pledged: 2,
        amount: 100,
        rate: 'variable',
        symbol: 'NVDA',
      },
    });
    assert.equal(state.book.borrows[0].status, 'active');
    assert.ok(state.book.events.some((e) => e.title === 'Cash borrowed'));
    const borrow = store.mutations(session.id).find((r) => r.key === borrowKey)!;
    assert.equal(borrow.action_type, 'borrow');
    assert.equal(JSON.parse(borrow.detail).events[0].title, 'Cash borrowed');

    const types = store
      .mutations(session.id)
      .map((r) => r.action_type)
      .sort();
    assert.ok(types.includes('lend'));
    assert.ok(types.includes('short'));
    assert.ok(types.includes('borrow'));
    assert.ok(types.includes('transfer'));
  } finally {
    store.close();
  }
});

void test('sandbox tracking: failed commit rolls back mutation row with balances and quote', () => {
  const store = new Store(':memory:');
  try {
    const session = store.createSession().session,
      service = new VaultService(store);
    service.apply(session, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1000,
      },
    });
    const quote = service.quote(session, randomUUID(), {
      revision: 1,
      terms: templateTerms('call-spread', '2025-02-07'),
    });
    const before = service.snapshot(session);
    const mutationsBefore = store.mutations(session.id).length;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_mutation BEFORE INSERT ON vault_mutations BEGIN SELECT RAISE(ABORT, 'injected mutation failure'); END;",
    );
    assert.throws(
      () =>
        service.apply(session, randomUUID(), {
          revision: 1,
          action: { type: 'execute', quoteId: quote.id },
        }),
      /injected mutation failure|VAULT_REJECTED|INTERNAL|SQLITE/,
    );
    assert.deepEqual(service.snapshot(session).book, before.book);
    assert.equal(service.snapshot(session).revision, before.revision);
    assert.equal(store.mutations(session.id).length, mutationsBefore);
    assert.equal(
      store.db
        .prepare('SELECT consumed FROM vault_quotes WHERE id=?')
        .get(quote.id)!.consumed,
      0,
    );
  } finally {
    store.close();
  }
});

class Chain implements VaultChainAdapter {
  readonly network = 'localnet' as const;
  book = initialVault();
  revision = 0;
  private plan!: VaultPlan;
  async prepare(
    _owner: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ): Promise<PreparedVaultTransaction | null> {
    if (stage === 'initialize') return null;
    this.plan = plan;
    return {
      raw: 'signed-original-bytes',
      signature: 'tracking-signature',
      lastValidHeight: 99,
      ledger: 'test-ledger',
      stage,
    };
  }
  async broadcast() {
    this.book = this.plan.book;
    this.revision = this.plan.revision + 1;
  }
  async status() {
    return this.revision === 0 ? ('pending' as const) : ('confirmed' as const);
  }
  async verify(_owner: string, b: VaultBook, revision: number) {
    assert.equal(revision, this.revision);
    assert.ok(bookBytes(b).equals(bookBytes(this.book)));
    return { ledger: 'test-ledger', slot: 42 };
  }
}

void test('chain tracking: confirmed ops record action_type, signature, revision and localnet mutation', async () => {
  const store = new Store(':memory:');
  try {
    const session = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain(),
      coordinator = new VaultChainCoordinator(store, vault, chain),
      key = randomUUID();
    const result = await coordinator.apply(session, key, {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 250,
      },
    });
    assert.equal(result.mode, 'localnet');
    assert.equal(result.chain?.signature, 'tracking-signature');
    assert.equal(result.revision, 1);

    const op = store.db
      .prepare('SELECT * FROM vault_chain_operations WHERE owner=? AND key=?')
      .get(session.id, key) as {
      status: string;
      action_type: string;
      signature: string;
      revision_after: number;
    };
    assert.equal(op.status, 'confirmed');
    assert.equal(op.action_type, 'transfer');
    assert.equal(op.signature, 'tracking-signature');
    assert.equal(op.revision_after, 1);

    const mutation = store.mutations(session.id).find((r) => r.key === key)!;
    assert.equal(mutation.mode, 'localnet');
    assert.equal(mutation.action_type, 'transfer');
    assert.equal(mutation.revision_after, 1);
    assert.equal(JSON.parse(mutation.detail).chain.signature, 'tracking-signature');
  } finally {
    store.close();
  }
});
