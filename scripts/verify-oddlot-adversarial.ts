import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Store } from '../server/db/store';
import { VaultService } from '../server/oddlot/service';
import { VaultChainCoordinator } from '../server/oddlot/chain/coordinator';
import { OddlotAdapter } from '../server/oddlot/chain/adapter';
import { configFromEnv } from '../server/config';
import { templateTerms } from '../lib/oddlot/templates';
import { terms } from '../server/oddlot/chain/codec';
import { u64 } from '../server/solana/codec';
const config = configFromEnv(),
  adapter = new OddlotAdapter(config),
  store = new Store(':memory:');
await adapter.health();
const service = new VaultService(store),
  coordinator = new VaultChainCoordinator(store, service, adapter),
  s = store.createSession().session;
const operator = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${config.stateDir}/deployer.json`, 'utf8')),
  ),
);
const owner = Keypair.fromSeed(
  createHmac('sha256', operator.secretKey)
    .update(`oddlot:v1:${s.id}:owner`)
    .digest(),
);
let revision = 0;
async function act(action: Record<string, unknown>) {
  const input = { revision, action },
    key = randomUUID();
  for (let n = 0; ; n++) {
    try {
      const result = await coordinator.apply(s, key, input);
      revision = result.revision;
      return result;
    } catch (e) {
      if (n > 3 || !(e as Error).message.includes('pending')) throw e;
    }
  }
}
const results: { name: string; error: unknown; log: string[] }[] = [];
try {
  await act({
    type: 'transfer',
    asset: 'USDC',
    direction: 'deposit',
    amount: 1000,
  });
  await act({
    type: 'transfer',
    asset: 'NVDA',
    direction: 'deposit',
    amount: 1,
  });
  const q = service.quote(s, randomUUID(), {
    revision,
    terms: templateTerms('covered-call', '2025-02-07'),
  });
  await act({ type: 'execute', quoteId: q.id });
  const snapshot = service.snapshot(s);
  const plan = store.transaction(() =>
    service.plan(s, {
      revision,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1,
      },
    }),
  );
  const prepared = (await adapter.prepare(s.id, plan, 'execute'))!;
  const decoded = () => Transaction.from(Buffer.from(prepared.raw, 'base64'));
  async function reject(
    name: string,
    mutate: (tx: Transaction) => Keypair | void,
    expected: string,
  ) {
    const tx = decoded(),
      alternate = mutate(tx);
    tx.sign(operator, alternate || owner);
    const result = await adapter.connection.simulateTransaction(
      VersionedTransaction.deserialize(tx.serialize()),
      { sigVerify: true },
    );
    assert.ok(result.value.err, `${name} unexpectedly accepted`);
    const logs = result.value.logs || [];
    assert.ok(
      logs.some((l) => l.includes(expected)),
      `${name}: ${logs.join('\n')}`,
    );
    await adapter.verify(s.id, snapshot.book, revision);
    results.push({
      name,
      error: result.value.err,
      log: logs.filter((l) => l.includes('Error')),
    });
    console.log('Rejected:', name);
  }
  const ix = (tx: Transaction) =>
    tx.instructions.find((i) => i.programId.equals(adapter.program))!;
  await reject(
    'wrong owner signer',
    (tx) => {
      const stranger = Keypair.generate();
      ix(tx).keys[1].pubkey = stranger.publicKey;
      return stranger;
    },
    'ConstraintHasOne',
  );
  await reject(
    'wrong mint',
    (tx) => {
      ix(tx).keys[3].pubkey = ix(tx).keys[4].pubkey;
    },
    'ConstraintHasOne',
  );
  await reject(
    'stale revision',
    (tx) => {
      ix(tx).data.writeBigUInt64LE(BigInt(revision + 1), 8);
    },
    'Revision',
  );
  await reject(
    'expired authorization',
    (tx) => {
      ix(tx).data.writeBigInt64LE(1n, 16);
    },
    'Expired',
  );
  await reject(
    'unfunded deposit',
    (tx) => {
      ix(tx).data.writeBigUInt64LE(20_000_000_000n, 27);
    },
    'Balance',
  );
  await reject(
    'withdraw pledged shares',
    (tx) => {
      const data = ix(tx).data;
      data[25] = 0;
      data[26] = 1;
      data.writeBigUInt64LE(1_000_000n, 27);
    },
    'Collateral',
  );
  await reject(
    'incorrect backend projection',
    (tx) => {
      ix(tx).data.fill(0, ix(tx).data.length - 32);
    },
    'Projection',
  );
  const empty = templateTerms('call-spread', '2025-02-07');
  empty.quantity = 0.000001;
  empty.legs[1].strike = 140.000001;
  await reject(
    'premium for zero-payoff contract',
    (tx) => {
      const i = ix(tx);
      i.data = Buffer.concat([
        i.data.subarray(0, 24),
        Buffer.from([2]),
        Buffer.alloc(16, 17),
        terms(empty),
        u64(1),
        Buffer.alloc(32),
      ]);
    },
    'InvalidTerms',
  );
  const bounded = templateTerms('call-spread', '2025-02-07');
  await reject(
    'bounded premium above entire payable value',
    (tx) => {
      const i = ix(tx);
      i.data = Buffer.concat([
        i.data.subarray(0, 24),
        Buffer.from([2]),
        Buffer.alloc(16, 18),
        terms(bounded),
        u64(11_000_000),
        Buffer.alloc(32),
      ]);
    },
    'InvalidTerms',
  );
  writeFileSync(
    process.env.ODDLOT_ADVERSARIAL_EVIDENCE || '/tmp/oddlot-adversarial.json',
    JSON.stringify(
      {
        network: 'isolated Solana local validator',
        program: adapter.program.toBase58(),
        generatedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  store.close();
}
