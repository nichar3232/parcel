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
    return this.revision === 0 ? ('pending' as const) : ('confirmed' as const);
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
