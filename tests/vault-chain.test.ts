import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService, type VaultPlan } from '../server/parcel/service';
import { VaultChainCoordinator } from '../server/parcel/chain/coordinator';
import type {
  PreparedVaultTransaction,
  VaultChainAdapter,
} from '../server/parcel/chain/adapter';
import { initialVault } from '../server/parcel/ledger';
import type { VaultBook } from '../lib/parcel/types';
import { bookBytes } from '../server/parcel/chain/codec';
class Chain implements VaultChainAdapter {
  readonly network = 'localnet' as const;
  book = initialVault();
  revision = 0;
  sends = 0;
  prepares = 0;
  loseVerification = false;
  loseSend = false;
  unavailable = false;
  private plan!: VaultPlan;
  async prepare(
    _owner: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ): Promise<PreparedVaultTransaction | null> {
    if (stage === 'initialize') return null;
    this.prepares++;
    this.plan = plan;
    return {
      raw: 'signed-original-bytes',
      signature: 'original-signature',
      lastValidHeight: 99,
      ledger: 'test-ledger',
      stage,
    };
  }
  async broadcast(raw: string) {
    assert.equal(raw, 'signed-original-bytes');
    this.sends++;
    this.book = this.plan.book;
    this.revision = this.plan.revision + 1;
    if (this.loseSend) throw Error('lost RPC response');
  }
  async status() {
    if (this.unavailable) return 'pending' as const;
    // Only this operation's broadcast advances revision. A prior confirmed
    // action must not make the next signature look settled before send.
    return this.revision === this.plan.revision + 1
      ? ('confirmed' as const)
      : ('pending' as const);
  }
  async verify(_owner: string, b: VaultBook, revision: number) {
    if (this.loseVerification) {
      this.loseVerification = false;
      throw Error('lost verification response');
    }
    assert.equal(revision, this.revision);
    assert.ok(bookBytes(b).equals(bookBytes(this.book)));
    return { ledger: 'test-ledger', slot: 123 };
  }
}
const deposit = {
  revision: 0,
  action: {
    type: 'transfer',
    asset: 'USDC',
    direction: 'deposit',
    amount: 100,
  },
};
void test('onchain success followed by interrupted indexing resumes the original signed operation after restart', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    const first = new VaultChainCoordinator(store, vault, chain),
      key = randomUUID();
    chain.loseVerification = true;
    await assert.rejects(first.apply(s, key, deposit), /lost verification/);
    assert.equal(vault.snapshot(s).revision, 0);
    assert.equal(chain.revision, 1);
    const restarted = new VaultChainCoordinator(
      store,
      new VaultService(store),
      chain,
    );
    await assert.rejects(
      restarted.apply(s, randomUUID(), deposit),
      /original pending action/,
    );
    const result = await restarted.apply(s, key, deposit);
    assert.equal(result.revision, 1);
    assert.equal(result.book.vault.USDC, 100);
    assert.equal(result.mode, 'localnet');
    assert.equal(chain.prepares, 1);
    assert.equal(chain.sends, 1);
    const duplicate = await restarted.apply(s, key, deposit);
    assert.deepEqual(duplicate, result);
    await assert.rejects(
      restarted.apply(s, key, { ...deposit, revision: 1 }),
      /different terms/,
    );
  } finally {
    store.close();
  }
});
void test('lost broadcast response is reconciled from the signature without a second economic execution', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    chain.loseSend = true;
    const c = new VaultChainCoordinator(store, vault, chain);
    const result = await c.apply(s, randomUUID(), deposit);
    assert.equal(result.book.vault.USDC, 100);
    assert.equal(chain.sends, 1);
    assert.equal(chain.prepares, 1);
  } finally {
    store.close();
  }
});
void test('onchain mutations remain uncommitted in SQLite while confirmation is pending', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    chain.unavailable = true;
    const c = new VaultChainCoordinator(store, vault, chain),
      key = randomUUID();
    await assert.rejects(c.apply(s, key, deposit), /Confirmation is pending/);
    assert.equal(vault.snapshot(s).book.vault.USDC, 0);
    const row = store.db
      .prepare(
        'SELECT transaction_json FROM vault_chain_operations WHERE owner=? AND key=?',
      )
      .get(s.id, key)!;
    assert.equal(
      JSON.parse(row.transaction_json as string).raw,
      'signed-original-bytes',
    );
    chain.unavailable = false;
    const result = await c.apply(s, key, deposit);
    assert.equal(result.book.vault.USDC, 100);
    assert.equal(chain.prepares, 1);
    assert.equal(chain.sends, 1);
  } finally {
    store.close();
  }
});

void test('a rejected chain-mode intent is a definite conflict and never leaves a pending operation', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    const c = new VaultChainCoordinator(store, vault, chain);
    await assert.rejects(
      c.apply(s, randomUUID(), {
        revision: 0,
        action: {
          type: 'transfer',
          asset: 'USDC',
          direction: 'withdraw',
          amount: 1,
        },
      }),
      (e: unknown) =>
        !!e && typeof e === 'object' && 'status' in e && e.status === 409,
    );
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM vault_chain_operations').get()!
        .n,
      0,
    );
    assert.equal(chain.prepares, 0);
    assert.equal(
      (await c.apply(s, randomUUID(), deposit)).book.vault.USDC,
      100,
    );
  } finally {
    store.close();
  }
});

void test('an unknown action is refused in chain mode before it can block the session', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    const c = new VaultChainCoordinator(store, vault, chain);
    await assert.rejects(
      c.apply(s, randomUUID(), {
        revision: 0,
        action: { type: 'not-a-real-action' },
      }),
      (e: unknown) =>
        !!e &&
        typeof e === 'object' &&
        'code' in e &&
        e.code === 'CHAIN_UNSUPPORTED',
    );
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM vault_chain_operations').get()!
        .n,
      0,
    );
    assert.equal(chain.prepares, 0);
    assert.equal(
      (await c.apply(s, randomUUID(), deposit)).book.vault.USDC,
      100,
    );
  } finally {
    store.close();
  }
});

void test('onchain cash borrow against pledged NVDA commits through the coordinator', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    const c = new VaultChainCoordinator(store, vault, chain);
    let state = await c.apply(s, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'NVDA',
        direction: 'deposit',
        amount: 2,
      },
    });
    state = await c.apply(s, randomUUID(), {
      revision: state.revision,
      action: {
        type: 'borrow',
        symbol: 'NVDA',
        pledged: 1,
        amount: 50,
        rate: 'variable',
      },
    });
    assert.equal(state.mode, 'localnet');
    assert.equal(state.book.borrows[0].status, 'active');
    assert.equal(state.book.borrows[0].principal, 50);
    assert.ok(state.chain?.signature);
    const mutation = store
      .mutations(s.id)
      .find((r) => r.action_type === 'borrow')!;
    assert.equal(mutation.mode, 'localnet');
    assert.equal(mutation.revision_after, state.revision);
  } finally {
    store.close();
  }
});

void test('onchain option execute stores the Black-Scholes traded premium on the fill', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    const c = new VaultChainCoordinator(store, vault, chain);
    let state = await c.apply(s, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1000,
      },
    });
    const { templateTerms } = await import('../lib/parcel/templates');
    const { tradedPremium } = await import('../server/parcel/ledger');
    const terms = templateTerms('call', '2025-02-07');
    terms.quantity = 0.25;
    const expected = tradedPremium(terms, state.book);
    const quote = vault.quote(s, randomUUID(), {
      revision: state.revision,
      terms,
    });
    assert.equal(quote.premium, expected);
    state = await c.apply(s, randomUUID(), {
      revision: state.revision,
      action: { type: 'execute', quoteId: quote.id },
    });
    assert.equal(state.book.options[0].premium, expected);
    assert.equal(state.mode, 'localnet');
    const mutation = store
      .mutations(s.id)
      .find((r) => r.action_type === 'execute')!;
    assert.equal(mutation.premium, expected);
    assert.equal(mutation.mode, 'localnet');
  } finally {
    store.close();
  }
});
void test('a simulated program rejection fails the op and frees the session for a new key', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store);
    const chain = new Chain();
    chain.prepare = async () => {
      throw Error(
        'Parcel program rejected the prepared action: {"InstructionError":[0,"Custom"]}',
      );
    };
    const c = new VaultChainCoordinator(store, vault, chain);
    const key = randomUUID();
    await assert.rejects(
      c.apply(s, key, deposit),
      (e: unknown) =>
        !!e &&
        typeof e === 'object' &&
        'code' in e &&
        e.code === 'CHAIN_REJECTED',
    );
    const row = store.db
      .prepare(
        'SELECT status,error,transaction_json,action_type FROM vault_chain_operations WHERE owner=? AND key=?',
      )
      .get(s.id, key) as {
      status: string;
      error: string;
      transaction_json: string | null;
      action_type: string;
    };
    assert.equal(row.status, 'failed');
    assert.equal(row.transaction_json, null);
    assert.equal(row.action_type, 'transfer');
    assert.match(row.error, /Parcel program rejected/);
    assert.equal(vault.snapshot(s).revision, 0);

    // Failed ops do not occupy the one-pending slot.
    const chain2 = new Chain();
    const recovered = await new VaultChainCoordinator(
      store,
      vault,
      chain2,
    ).apply(s, randomUUID(), deposit);
    assert.equal(recovered.book.vault.USDC, 100);
  } finally {
    store.close();
  }
});

void test('an expired signature is recorded as failed without committing balances', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store),
      chain = new Chain();
    chain.status = async () => 'expired' as const;
    const c = new VaultChainCoordinator(store, vault, chain);
    const key = randomUUID();
    await assert.rejects(c.apply(s, key, deposit), /expired without confirmation/);
    assert.equal(vault.snapshot(s).revision, 0);
    const row = store.db
      .prepare(
        'SELECT status,error,signature,transaction_json FROM vault_chain_operations WHERE owner=? AND key=?',
      )
      .get(s.id, key) as {
      status: string;
      error: string;
      signature: string | null;
      transaction_json: string | null;
    };
    assert.equal(row.status, 'failed');
    assert.ok(row.transaction_json, 'signed bytes retained for forensics');
    assert.equal(row.signature, 'original-signature');
    assert.match(row.error, /expired/);
  } finally {
    store.close();
  }
});
