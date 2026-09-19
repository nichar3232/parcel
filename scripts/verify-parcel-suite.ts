// Explicit private-validator integration of the product-suite protocol.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { configFromEnv } from '../server/config';
import { ParcelAdapter } from '../server/parcel/chain/adapter';
import { VaultChainCoordinator } from '../server/parcel/chain/coordinator';
import { VaultService } from '../server/parcel/service';
import { Store } from '../server/db/store';
import { templateTerms } from '../lib/parcel/templates';
import { cashPayoff } from '../lib/parcel/math';
import type {
  OrderTerms,
  VaultAction,
  VaultSnapshot,
} from '../lib/parcel/types';
const config = configFromEnv();
if (!config.parcel || config.network !== 'localnet')
  throw Error('Explicit pinned private-validator configuration required.');
const adapter = new ParcelAdapter(config);
await adapter.health();
const store = new Store(':memory:'),
  session = store.createSession().session;
const service = new VaultService(store, Date.now, 64),
  coordinator = new VaultChainCoordinator(store, service, adapter);
let state = coordinator.snapshot(session);
const evidence: {
  action: string;
  revision: number;
  chain: VaultSnapshot['chain'];
  cash: number;
  shares: number;
}[] = [];
async function act(action: VaultAction) {
  const input = { revision: state.revision, action },
    key = randomUUID();
  for (let n = 0; ; n++) {
    try {
      state = await coordinator.apply(session, key, input);
      break;
    } catch (e) {
      if (n >= 4 || !(e as Error).message.includes('pending')) throw e;
    }
  }
  assert.ok(state.chain?.signature);
  assert.equal(state.mode, 'localnet');
  assert.equal(
    (await coordinator.apply(session, key, input)).revision,
    state.revision,
  );
  evidence.push({
    action: action.type,
    revision: state.revision,
    chain: state.chain,
    cash: state.risk.cash,
    shares: state.risk.shares.NVDA,
  });
  console.log(action.type, state.revision, state.chain.signature);
}
async function open(terms: OrderTerms) {
  const q = service.quote(session, randomUUID(), {
    revision: state.revision,
    terms,
  });
  assert.ok(q.eligible, q.reason);
  await act({ type: 'execute', quoteId: q.id });
  return state.book.options[0].id;
}
try {
  await act({
    type: 'transfer',
    direction: 'deposit',
    asset: 'USDC',
    amount: 1000,
  });
  if (process.argv.includes('--capacity')) {
    for (let i = 0; i < 64; i++) {
      const t = templateTerms('exponential', '2025-01-24T01:00:00Z');
      t.quantity = 0.333333;
      t.curve!.side = i % 2 ? 'sell' : 'buy';
      t.curve!.upper = Math.round((142.620001 + i / 1e6) * 1e6) / 1e6;
      await open(t);
    }
    await act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'USDC',
      amount: state.risk.freeCash,
    });
    await act({ type: 'advance', date: '2025-01-27' });
    assert.equal(
      state.book.options.filter((p) => p.status === 'active').length,
      0,
    );
  } else {
    const early = templateTerms('box', '2025-01-24T01:00:00Z');
    const later = templateTerms('call-spread', '2025-01-24T04:00:00Z');
    later.legs = later.legs.map((l) => ({
      ...l,
      side: l.side === 'buy' ? 'sell' : 'buy',
    }));
    await open(early);
    await open(later);
    assert.equal(state.risk.cash, 0);
    await act({
      type: 'transfer',
      direction: 'withdraw',
      asset: 'USDC',
      amount: state.risk.freeCash,
    });
    await act({ type: 'advance', date: '2025-01-24T04:00:00Z' });
    assert.equal(
      state.book.options.filter((p) => p.status === 'active').length,
      0,
    );
    await act({
      type: 'transfer',
      direction: 'deposit',
      asset: 'USDC',
      amount: 1000,
    });
    for (const id of ['quadratic', 'exponential']) {
      const t = templateTerms(id, '2025-01-24T08:00:00Z');
      t.quantity = 0.333333;
      await open(t);
      const opposed = structuredClone(t);
      opposed.curve!.side = 'sell';
      await open(opposed);
      assert.equal(state.risk.cash, 0);
    }
    await act({
      type: 'transfer',
      direction: 'deposit',
      asset: 'NVDA',
      amount: 2,
    });
    await act({
      type: 'lend',
      quantity: 0.333333,
      expiry: '2025-01-24T08:00:00Z',
    });
    await act({
      type: 'short',
      quantity: 0.333333,
      cap: 160,
      expiry: '2025-01-24T08:00:00Z',
    });
    await act({ type: 'advance', date: '2025-01-27' });
    for (const p of state.book.options.filter((p) => p.terms.curve))
      assert.equal(p.cashFlow, cashPayoff(p.terms, 142.62));
    for (const id of ['dividend-floor', 'dividend-range', 'dividend-curve'])
      await open(templateTerms(id, '2025-02-07'));
    const t = templateTerms('exponential', '2025-03-12');
    const id = await open(t);
    const q = service.quote(session, randomUUID(), {
      revision: state.revision,
      positionId: id,
    });
    await act({ type: 'execute', quoteId: q.id });
    await act({ type: 'advance', date: '2025-03-12' });
    assert.equal(
      state.book.options.filter((p) => p.status === 'active').length,
      0,
    );
    await act({ type: 'restart' });
  }
  writeFileSync(
    process.argv.includes('--capacity')
      ? '/tmp/parcel-suite-capacity.json'
      : '/tmp/parcel-suite-chain.json',
    JSON.stringify(
      {
        program: adapter.program.toBase58(),
        protocol: 2,
        network: 'private local validator',
        actions: evidence,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  store.close();
}
