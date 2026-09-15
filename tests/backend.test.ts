import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { PortfolioService } from '../server/domain/portfolio';
import { ChainService } from '../server/domain/chain';
import { createApp } from '../server/app';
import { configFromEnv } from '../server/config';
import { conservation, type Terms } from '../lib/engine';
import type {
  ChainPosition,
  ChainAction,
  SessionPortfolio,
} from '../lib/contracts/api';
import type { ChainAdapter, Prepared } from '../server/solana/adapter';
const terms: Terms = {
  kind: 'put',
  low: 120,
  high: 140,
  quantity: 100,
  premium: 400,
  expiry: '2025-01-27',
  scenario: 'deepseek',
};
function setup() {
  const store = new Store(':memory:'),
    { session } = store.createSession();
  return {
    store,
    session,
    service: new PortfolioService(store, () => 1800000000000),
  };
}
void test('portfolio: durable idempotency, exact revision, no client-supplied clock or RFQ ID', () => {
  const { store, session, service } = setup();
  try {
    const key = randomUUID(),
      request = {
        revision: 0,
        action: { type: 'request', terms, id: 'ATTACK', now: 0 },
      };
    const a = service.apply(session, key, request),
      b = service.apply(session, key, request);
    assert.deepEqual(a, b);
    assert.notEqual(a.book.positions[0].id, 'ATTACK');
    assert.equal(a.book.positions[0].createdAt, 1800000000000);
    assert.throws(
      () => service.apply(session, randomUUID(), request),
      /another request/,
    );
    assert.throws(
      () => service.apply(session, key, { ...request, revision: 1 }),
      /different terms/,
    );
    assert.equal(store.portfolio(session).revision, 1);
  } finally {
    store.close();
  }
});
void test('portfolio: both claims conserve fractional base units, settlement cannot be fabricated', () => {
  const { store, session, service } = setup();
  try {
    let view = store.portfolio(session);
    const run = (action: Record<string, unknown>) =>
      (view = service.apply(session, randomUUID(), {
        revision: view.revision,
        action,
      }));
    run({
      type: 'request',
      terms: { ...terms, quantity: 0.333333, premium: 0.123456 },
    });
    const id = view.book.positions[0].id;
    run({ type: 'fund', id, premium: 0.123456 });
    run({ type: 'accept', id });
    assert.throws(
      () =>
        run({
          type: 'settle',
          id,
          date: '2025-01-27',
          price: 0,
          available: true,
        }),
      /fixed by the backend/,
    );
    run({ type: 'settle', id, date: '2025-01-27', available: false });
    assert.equal(view.book.positions[0].status, 'awaiting');
    run({ type: 'settle', id, date: '2025-01-27', available: true });
    assert.throws(
      () => run({ type: 'claim', id, party: 'intruder' }),
      /holder or maker/,
    );
    run({ type: 'claim', id, party: 'holder' });
    run({ type: 'claim', id, party: 'maker' });
    assert.equal(view.book.positions[0].status, 'closed');
    assert.equal(conservation(view.book), 60000);
    assert.throws(
      () => run({ type: 'claim', id, party: 'holder' }),
      /no unpaid/,
    );
  } finally {
    store.close();
  }
});
void test('portfolio: rejects malformed, unsupported and zero-base-unit terms', () => {
  const { store, session, service } = setup();
  try {
    for (const t of [
      { ...terms, scenario: 'fake' },
      { ...terms, quantity: 1e-6, high: 120.000001 },
      { ...terms, expiry: '2025-01-24' },
      { ...terms, premium: '400' },
      { ...terms, oracle: 'custom' },
    ])
      assert.throws(() =>
        service.apply(session, randomUUID(), {
          revision: 0,
          action: { type: 'request', terms: t },
        }),
      );
    assert.equal(store.portfolio(session).revision, 0);
  } finally {
    store.close();
  }
});
void test('SQLite: portfolio and receipts survive process-store restart', async () => {
  const dir = await mkdtemp(`${tmpdir()}/strata-db-`),
    file = `${dir}/db.sqlite`;
  let store = new Store(file);
  try {
    const { session, token } = store.createSession(),
      key = randomUUID(),
      request = { revision: 0, action: { type: 'request', terms } };
    const a = new PortfolioService(store).apply(session, key, request);
    store.close();
    store = new Store(file);
    const restored = store.session(token)!;
    assert.equal(restored.id, session.id);
    assert.deepEqual(
      new PortfolioService(store).apply(restored, key, request),
      a,
    );
    assert.equal(store.portfolio(restored).book.positions.length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
class FakeChain implements ChainAdapter {
  prepares = 0;
  broadcasts: string[] = [];
  state: 'pending' | 'confirmed' | 'expired' = 'pending';
  unavailable = false;
  proofFails = false;
  async health() {
    return {
      ready: !this.unavailable,
      network: 'localnet' as const,
      reason: this.unavailable ? 'RPC unavailable' : undefined,
    };
  }
  async prepare(
    _owner: string,
    _action: ChainAction,
    p: ChainPosition | undefined,
  ): Promise<Prepared> {
    this.prepares++;
    return {
      position: p || {
        id: randomUUID(),
        network: 'localnet',
        programId: 'test',
        mint: 'test',
        holder: 'h',
        maker: 'm',
        offer: 'o',
        vault: 'v',
        market: 'q',
        terms,
        nonce: '1',
        expiry: 1,
        deadline: 0,
        historicalAt: 1,
        price: 118.42,
        transactions: [],
        status: 'prepared',
        buyerPayout: 0,
        buyerClaimed: false,
        makerClaimed: false,
        escrow: 0,
        lastSlot: 0,
        updatedAt: new Date().toISOString(),
      },
      signature: 's'.repeat(88),
      raw: 'signed-immutable-bytes',
      lastValidHeight: 100,
    };
  }
  async broadcast(raw: string) {
    this.broadcasts.push(raw);
    if (this.unavailable) throw Error('socket lost');
  }
  async confirmation() {
    if (this.unavailable) throw Error('socket lost');
    return this.state;
  }
  async read(p: ChainPosition): Promise<ChainPosition> {
    return { ...p, status: 'funded' as const, escrow: 2000, pending: false };
  }
  async proof() {
    if (this.proofFails) throw Error('archive unavailable');
    return { slot: 12 };
  }
}
void test('chain: signed bytes and identity exist before broadcast; restart retries the same transaction', async () => {
  const dir = await mkdtemp(`${tmpdir()}/strata-chain-`),
    file = `${dir}/db`;
  let store = new Store(file);
  try {
    const { session } = store.createSession(),
      adapter = new FakeChain(),
      key = randomUUID();
    let service = new ChainService(store, adapter, dir);
    const p = await service.action(session, key, { action: 'fund', terms });
    assert.equal(p.pending, true);
    assert.equal(adapter.prepares, 1);
    assert.equal(
      store.operation(session.id, key)?.raw_transaction,
      'signed-immutable-bytes',
    );
    store.close();
    store = new Store(file);
    service = new ChainService(store, adapter, dir);
    await service.action(session, key, { action: 'fund', terms });
    assert.equal(adapter.prepares, 1);
    assert.deepEqual(adapter.broadcasts, [
      'signed-immutable-bytes',
      'signed-immutable-bytes',
    ]);
    adapter.state = 'confirmed';
    adapter.proofFails = true;
    const result = await service.read(session, p.id);
    assert.equal(result.status, 'funded');
    assert.equal(result.transactions.length, 1);
    assert.equal(store.operation(session.id, key)?.status, 'confirmed');
    await service.action(session, key, { action: 'fund', terms });
    assert.equal(store.position(session.id, p.id).transactions.length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
void test('chain: cross-session read/mutation denied, duplicate keys cannot change terms', async () => {
  const { store, session } = setup();
  try {
    const other = store.createSession().session,
      adapter = new FakeChain(),
      service = new ChainService(store, adapter, tmpdir()),
      key = randomUUID(),
      p = await service.action(session, key, { action: 'fund', terms });
    await assert.rejects(service.read(other, p.id), /your session/);
    await assert.rejects(
      service.action(other, randomUUID(), { action: 'accept', id: p.id }),
      /your session/,
    );
    await assert.rejects(
      service.action(session, key, {
        action: 'fund',
        terms: { ...terms, premium: 500 },
      }),
      /different terms/,
    );
    assert.equal(adapter.prepares, 1);
  } finally {
    store.close();
  }
});
void test('chain: concurrent requests serialize and an unresolved transaction blocks a new action', async () => {
  const { store, session } = setup();
  try {
    const adapter = new FakeChain(),
      service = new ChainService(store, adapter, tmpdir()),
      key = randomUUID();
    const results = await Promise.allSettled([
      service.action(session, key, { action: 'fund', terms }),
      service.action(session, key, { action: 'fund', terms }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const p = store.positions(session.id)[0];
    await service.action(session, randomUUID(), { action: 'accept', id: p.id });
    assert.equal(adapter.prepares, 1);
    adapter.state = 'expired';
    await service.read(session, p.id);
    assert.equal(store.operation(session.id, key)?.status, 'failed');
  } finally {
    store.close();
  }
});
void test('chain: unknown RPC status remains recoverable and does not claim confirmation', async () => {
  const { store, session } = setup();
  try {
    const adapter = new FakeChain(),
      service = new ChainService(store, adapter, tmpdir()),
      key = randomUUID();
    adapter.unavailable = true;
    const p = await service.action(session, key, { action: 'fund', terms });
    assert.equal(p.pending, true);
    assert.equal(p.transactions.length, 0);
    adapter.unavailable = false;
    adapter.state = 'confirmed';
    const recovered = await service.read(session, p.id);
    assert.equal(recovered.transactions.length, 1);
  } finally {
    store.close();
  }
});
void test('HTTP: secure sessions, CSRF, malformed requests, concurrency, static ranges and readiness', async () => {
  const dir = await mkdtemp(`${tmpdir()}/strata-http-`),
    adapter = new FakeChain();
  await writeFile(`${dir}/index.html`, '<h1>Strata</h1>');
  await writeFile(`${dir}/demo.mp4`, '0123456789');
  const app = createApp(
    {
      ...configFromEnv({ CHAIN_ENABLED: 'false' }),
      stateDir: dir,
      publicDir: dir,
      port: 0,
    },
    { adapter },
  );
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const sessionResponse = await fetch(`${base}/api/session`),
      cookie = sessionResponse.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const session = (await sessionResponse.json()) as SessionPortfolio;
    const key = randomUUID(),
      headers = {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': session.csrf,
        'Idempotency-Key': key,
      };
    const request = JSON.stringify({
      revision: 0,
      action: { type: 'request', terms },
    });
    assert.equal(
      (
        await fetch(`${base}/api/portfolio/actions`, {
          method: 'POST',
          headers: { ...headers, 'X-CSRF-Token': 'bad' },
          body: request,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/portfolio/actions`, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.test' },
          body: request,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/portfolio/actions`, {
          method: 'POST',
          headers,
          body: '{',
        })
      ).status,
      400,
    );
    const responses = await Promise.all(
      [1, 2].map(() =>
        fetch(`${base}/api/portfolio/actions`, {
          method: 'POST',
          headers,
          body: request,
        }),
      ),
    );
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200],
    );
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    const fresh = await fetch(`${base}/api/portfolio`, {
      headers: { Cookie: cookie },
    });
    assert.equal(((await fresh.json()) as SessionPortfolio).revision, 1);
    assert.equal((await fetch(`${base}/api/portfolio`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/devnet/run`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      404,
    );
    const range = await fetch(`${base}/demo.mp4`, {
      headers: { Range: 'bytes=2-5' },
    });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), '2345');
    assert.equal(
      (await fetch(`${base}/demo.mp4`, { headers: { Range: 'bytes=100-' } }))
        .status,
      416,
    );
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    adapter.unavailable = true;
    const health = (await (await fetch(`${base}/api/health`)).json()) as {
      chain: { ready: boolean };
    };
    assert.equal(health.chain.ready, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      app.server.close((e) => (e ? reject(e) : resolve())),
    );
    app.store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
void test('chain: a delayed read preserves newer transaction evidence', async () => {
  const { store, session } = setup();
  try {
    const adapter = new FakeChain(),
      service = new ChainService(store, adapter, tmpdir());
    adapter.state = 'confirmed';
    let p = await service.action(session, randomUUID(), {
      action: 'fund',
      terms,
    });
    let finish: (p: ChainPosition) => void = () => {};
    adapter.read = () =>
      new Promise<ChainPosition>((resolve) => {
        finish = resolve;
      });
    const reading = service.read(session, p.id);
    p = {
      ...p,
      transactions: [
        ...p.transactions,
        { signature: 'newer-transaction', label: 'accept' },
      ],
    };
    store.savePosition(session.id, p);
    finish({ ...p, transactions: [], lastSlot: 10 });
    const result = await reading;
    assert.equal(result.transactions.length, 2);
    assert.equal(store.position(session.id, p.id).transactions.length, 2);
  } finally {
    store.close();
  }
});
void test('chain transport: a merely processed error remains pending until confirmation', async () => {
  const { SolanaAdapter } = await import('../server/solana/adapter');
  const adapter = new SolanaAdapter(configFromEnv({ CHAIN_ENABLED: 'false' }));
  adapter.connection.getSignatureStatuses = async () => ({
    context: { slot: 1 },
    value: [
      {
        slot: 1,
        confirmations: 0,
        confirmationStatus: 'processed',
        err: { InstructionError: [0, { Custom: 6006 }] },
      },
    ],
  });
  assert.equal(await adapter.confirmation('test', 10), 'pending');
  adapter.connection.getSignatureStatuses = async () => ({
    context: { slot: 2 },
    value: [
      {
        slot: 1,
        confirmations: 1,
        confirmationStatus: 'confirmed',
        err: { InstructionError: [0, { Custom: 6006 }] },
      },
    ],
  });
  assert.equal(typeof (await adapter.confirmation('test', 10)), 'object');
});
