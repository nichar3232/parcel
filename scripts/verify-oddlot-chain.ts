// Run against an explicitly pinned private validator, never a public funded chain.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { configFromEnv } from '../server/config';
import { OddlotAdapter } from '../server/oddlot/chain/adapter';
import { VaultChainCoordinator } from '../server/oddlot/chain/coordinator';
import { VaultService } from '../server/oddlot/service';
import { Store } from '../server/db/store';
import { templateTerms } from '../lib/oddlot/templates';
import type { VaultAction, VaultSnapshot } from '../lib/oddlot/types';
import assert from 'node:assert/strict';
const config = configFromEnv();
if (!config.oddlot || config.network !== 'localnet')
  throw Error('Explicit Parcel localnet configuration required.');
const adapter = new OddlotAdapter(config);
if (process.argv.includes('--create-test-mints')) {
  const genesis = await adapter.connection.getGenesisHash();
  if (
    genesis !== config.expectedGenesis ||
    [
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ].includes(genesis)
  )
    throw Error('Wrong validator.');
  const operator = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(`${config.stateDir}/deployer.json`, 'utf8')),
    ),
  );
  if (operator.publicKey.toBase58() !== config.authority)
    throw Error('Wrong operator.');
  const cash = await createMint(
      adapter.connection,
      operator,
      operator.publicKey,
      null,
      6,
    ),
    stock = await createMint(
      adapter.connection,
      operator,
      operator.publicKey,
      null,
      6,
    );
  console.log(
    JSON.stringify({ cashMint: cash.toBase58(), stockMint: stock.toBase58() }),
  );
  process.exit(0);
}
await adapter.health();
const store = new Store(process.env.ODDLOT_TEST_DB || ':memory:');
const service = new VaultService(store),
  coordinator = new VaultChainCoordinator(store, service, adapter),
  session = store.createSession().session;
let state: VaultSnapshot = coordinator.snapshot(session);
const evidence: {
  action: string;
  revision: number;
  chain: VaultSnapshot['chain'];
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
  assert.equal(state.mode, 'localnet');
  assert.ok(state.chain?.signature);
  const again = await coordinator.apply(session, key, input);
  assert.equal(again.chain!.signature, state.chain!.signature);
  assert.equal(again.revision, state.revision);
  evidence.push({
    action: action.type,
    revision: state.revision,
    chain: state.chain,
  });
  console.log(action.type, state.revision, state.chain!.signature);
}
try {
  await act({
    type: 'transfer',
    asset: 'USDC',
    direction: 'deposit',
    amount: 1000,
  });
  if (process.argv.includes('--capacity')) {
    for (let i = 0; i < 64; i++) {
      const t = templateTerms('condor', '2025-02-07');
      t.quantity = 0.333333;
      t.legs = t.legs.map((l) => ({
        ...l,
        strike: Math.round((l.strike + i / 10000) * 1e6) / 1e6,
      }));
      const q = service.quote(session, randomUUID(), {
        revision: state.revision,
        terms: t,
      });
      await act({ type: 'execute', quoteId: q.id });
    }
    assert.equal(
      state.book.options.filter((p) => p.status === 'active').length,
      64,
    );
    await act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'withdraw',
      amount: state.risk.freeCash,
    });
    await act({ type: 'advance', date: '2025-02-07' });
    assert.equal(
      state.book.options.filter((p) => p.status === 'active').length,
      0,
    );
    writeFileSync(
      '/tmp/oddlot-capacity.json',
      JSON.stringify(
        {
          network: 'isolated Solana local validator',
          activePositions: 64,
          legs: 256,
          withdrawAllFreeCash: true,
          settled: true,
          actions: evidence,
        },
        null,
        2,
      ) + '\n',
    );
    process.exit(0);
  }
  await act({
    type: 'transfer',
    asset: 'NVDA',
    direction: 'deposit',
    amount: 2,
  });
  const t = templateTerms('covered-call', '2025-02-07');
  t.quantity = 0.333333;
  const q = service.quote(session, randomUUID(), {
    revision: state.revision,
    terms: t,
  });
  await act({ type: 'execute', quoteId: q.id });
  const close = service.quote(session, randomUUID(), {
    revision: state.revision,
    positionId: state.book.options[0].id,
  });
  await act({ type: 'execute', quoteId: close.id });
  await act({ type: 'lend', quantity: 0.333333, expiry: '2025-02-07' });
  await act({
    type: 'short',
    quantity: 0.333333,
    cap: 160,
    expiry: '2025-02-07',
  });
  const spread = templateTerms('put-spread', '2025-02-07');
  spread.quantity = 0.654321;
  const qs = service.quote(session, randomUUID(), {
    revision: state.revision,
    terms: spread,
  });
  await act({ type: 'execute', quoteId: qs.id });
  await act({ type: 'margin', mode: 'isolated' });
  await act({ type: 'margin', mode: 'cross' });
  await act({ type: 'advance', date: '2025-01-27' });
  await act({ type: 'recall', id: state.book.loans[0].id });
  await act({ type: 'close-short', id: state.book.shorts[0].id });
  await act({ type: 'advance', date: '2025-02-07' });
  const dividend = service.quote(session, randomUUID(), {
    revision: state.revision,
    terms: templateTerms('dividend-cap', '2025-03-12'),
  });
  await act({ type: 'execute', quoteId: dividend.id });
  await act({ type: 'stock', side: 'buy', quantity: 0.1 });
  await act({ type: 'stock', side: 'sell', quantity: 0.1 });
  await act({ type: 'advance', date: '2025-04-03' });
  await act({
    type: 'transfer',
    asset: 'USDC',
    direction: 'withdraw',
    amount: state.risk.freeCash,
  });
  await act({ type: 'restart' });
  const { PublicKey } = await import('@solana/web3.js');
  const [bank] = PublicKey.findProgramAddressSync(
    [Buffer.from('bank'), new PublicKey(state.chain!.ledger).toBuffer()],
    adapter.program,
  );
  const cash = await getAccount(
    adapter.connection,
    getAssociatedTokenAddressSync(
      new PublicKey(config.oddlot.cashMint),
      bank,
      true,
    ),
  );
  const stock = await getAccount(
    adapter.connection,
    getAssociatedTokenAddressSync(
      new PublicKey(config.oddlot.stockMint),
      bank,
      true,
    ),
  );
  assert.equal(cash.amount, 4_000_000_000_000n);
  assert.equal(stock.amount, 20_000_000_000n);
  const report = {
    network: 'isolated Solana local validator',
    program: adapter.program.toBase58(),
    generatedAt: new Date().toISOString(),
    checks: evidence.length,
    escrow: { cash: cash.amount.toString(), stock: stock.amount.toString() },
    actions: evidence,
  };
  writeFileSync(
    process.env.ODDLOT_EVIDENCE || '/tmp/oddlot-chain-evidence.json',
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  store.close();
}
