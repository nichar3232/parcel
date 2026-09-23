import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkEngine } from '../server/prices/engine';
import {
  MassiveStocksSource,
  type SocketLike,
  type Source,
} from '../server/prices/sources';

class Socket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

void test('Massive: subscribes server-side and preserves NBBO provenance', () => {
  const socket = new Socket();
  const source = new MassiveStocksSource(
    { MASSIVE_STOCKS_API_KEY: 'test-key' },
    () => socket,
  );
  const observations: unknown[] = [];
  const stop = source.subscribe!(
    [
      {
        symbol: 'NVDA',
        name: 'NVIDIA',
        kind: 'equity',
        vol: 0.45,
        seed: 100,
        spreadBps: 12,
        depth: 1,
      },
    ],
    (rows) => observations.push(...rows),
  );

  socket.onopen?.();
  assert.deepEqual(JSON.parse(socket.sent[0]!), {
    action: 'auth',
    params: 'test-key',
  });

  socket.message([{ ev: 'status', status: 'auth_success' }]);
  assert.deepEqual(JSON.parse(socket.sent[1]!), {
    action: 'subscribe',
    params: 'Q.NVDA,T.NVDA',
  });

  socket.message([{ ev: 'Q', sym: 'NVDA', bp: 142.61, ap: 142.63, t: Date.now() }]);
  assert.deepEqual(observations, [
    {
      symbol: 'NVDA',
      price: 142.62,
      bid: 142.61,
      ask: 142.63,
      at: (observations[0] as { at: number }).at,
      source: 'massive-nbbo',
      quoteKind: 'nbbo',
    },
  ]);
  assert.equal(source.health().state, 'live');
  stop();
  assert.equal(socket.closed, true);
});

void test('Massive: an authentication rejection disables instead of retrying a bad credential', () => {
  const socket = new Socket();
  const source = new MassiveStocksSource(
    { MASSIVE_STOCKS_API_KEY: 'bad-key' },
    () => socket,
  );
  source.subscribe!(
    [
      {
        symbol: 'NVDA',
        name: 'NVIDIA',
        kind: 'equity',
        vol: 0.45,
        seed: 100,
        spreadBps: 12,
        depth: 1,
      },
    ],
    () => undefined,
  );
  socket.onopen?.();
  socket.message([{ ev: 'status', status: 'auth_failed' }]);

  assert.equal(socket.closed, true);
  assert.deepEqual(source.health(), {
    name: 'massive-nbbo',
    enabled: false,
    state: 'disabled',
    detail: 'Listed-equity NBBO authentication was rejected',
  });
});

void test('marks: an NBBO keeps its real bid and ask instead of a modelled spread', () => {
  const now = Date.now();
  const source: Source = {
    name: 'massive-nbbo',
    enabled: true,
    async observe() {
      return [];
    },
    subscribe(_instruments, receive) {
      receive([
        {
          symbol: 'NVDA',
          price: 142.62,
          bid: 142.61,
          ask: 142.63,
          at: now,
          source: 'massive-nbbo',
          quoteKind: 'nbbo',
        },
      ]);
      return () => undefined;
    },
  };
  const engine = new MarkEngine(now, [source]);
  engine.start();
  const nvda = engine.mark('NVDA')!;
  engine.stop();

  assert.equal(nvda.source, 'massive-nbbo');
  assert.equal(nvda.quoteKind, 'nbbo');
  assert.equal(nvda.bid, 142.61);
  assert.equal(nvda.ask, 142.63);
});

void test('marks: stale higher-priority cache cannot mask a fresh lower-priority mark', async () => {
  const now = Date.now();
  const stale: Source = {
    name: 'massive-nbbo',
    enabled: true,
    async observe() {
      return [
        {
          symbol: 'NVDA',
          price: 100,
          at: now - 30_000,
          source: 'massive-nbbo',
        },
      ];
    },
  };
  const fresh: Source = {
    name: 'pyth',
    enabled: true,
    async observe() {
      return [
        {
          symbol: 'NVDA',
          price: 143,
          at: now,
          source: 'pyth',
          quoteKind: 'oracle',
        },
      ];
    },
  };
  const engine = new MarkEngine(now, [stale, fresh]);
  engine.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const nvda = engine.mark('NVDA')!;
  engine.stop();

  assert.equal(nvda.price, 143);
  assert.equal(nvda.source, 'pyth');
  assert.equal(nvda.quoteKind, 'modelled');
});

void test('marks: an old official equity print keeps provenance but cannot claim a live connection', () => {
  const realNow = Date.now;
  const base = realNow();
  let clock = base;
  Date.now = () => clock;
  try {
    const source: Source = {
      name: 'massive-nbbo',
      enabled: true,
      async observe() {
        return [];
      },
      subscribe(_instruments, receive) {
        receive([
          {
            symbol: 'NVDA',
            price: 142.62,
            bid: 142.61,
            ask: 142.63,
            at: base,
            source: 'massive-nbbo',
            quoteKind: 'nbbo',
          },
        ]);
        return () => undefined;
      },
    };
    const engine = new MarkEngine(base, [source]);
    engine.start();
    clock += 20_001;
    const nvda = engine.mark('NVDA')!;
    const snapshot = engine.snapshot();
    engine.stop();

    assert.equal(nvda.source, 'massive-nbbo');
    assert.equal(nvda.stale, true);
    assert.equal(nvda.quoteKind, 'modelled');
    assert.equal(snapshot.connected, false);
  } finally {
    Date.now = realNow;
  }
});
