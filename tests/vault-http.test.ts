import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app';
import { configFromEnv } from '../server/config';
import { templateTerms } from '../lib/parcel/templates';
import type { Quote, VaultSnapshot } from '../lib/parcel/types';

async function fixture() {
  const dir = await mkdtemp(`${tmpdir()}/parcel-http-audit-`);
  await writeFile(`${dir}/index.html`, '<h1>Parcel</h1>');
  await writeFile(`${dir}/legacy.html`, '<h1>Legacy desk</h1>');
  const config = {
    ...configFromEnv({ CHAIN_ENABLED: 'false' }),
    stateDir: `${dir}/state`,
    publicDir: dir,
    port: 0,
  };
  let app = createApp(config);
  const listen = async () => {
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const addr = app.server.address();
    assert.ok(addr && typeof addr === 'object');
    return `http://127.0.0.1:${addr.port}`;
  };
  let base = await listen();
  const stop = async () => {
    await new Promise<void>((resolve, reject) =>
      app.server.close((e) => (e ? reject(e) : resolve())),
    );
    app.store.close();
  };
  return {
    dir,
    get app() {
      return app;
    },
    get base() {
      return base;
    },
    async restart() {
      await stop();
      app = createApp(config);
      base = await listen();
    },
    async close() {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
    async client() {
      const r = await fetch(`${base}/api/session`);
      const cookie = r.headers.get('set-cookie')!.split(';')[0];
      const { csrf } = (await r.json()) as { csrf: string };
      const headers = {
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      };
      return {
        headers,
        snapshot: async () =>
          (await (
            await fetch(`${base}/api/vault`, { headers })
          ).json()) as VaultSnapshot,
        post: (
          route: string,
          input: unknown,
          key = randomUUID(),
          extra: Record<string, string> = {},
        ) =>
          fetch(`${base}/api/vault/${route}`, {
            method: 'POST',
            headers: { ...headers, 'Idempotency-Key': key, ...extra },
            body: JSON.stringify(input),
          }),
      };
    },
  };
}
void test('vault HTTP: actual routes enforce ownership, CSRF, input limits, revision and concurrent idempotency', async () => {
  const f = await fixture();
  try {
    const a = await f.client(),
      b = await f.client();
    assert.equal((await fetch(`${f.base}/api/vault`)).status, 401);
    for (const route of ['quote', 'actions']) {
      assert.equal(
        (await a.post(route, {}, randomUUID(), { 'X-CSRF-Token': 'wrong' }))
          .status,
        403,
      );
      assert.equal(
        (
          await a.post(route, {}, randomUUID(), {
            Origin: 'https://other.invalid',
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(`${f.base}/api/vault/${route}`, { headers: a.headers }))
          .status,
        405,
      );
      assert.equal(
        (
          await a.post(route, {}, randomUUID(), {
            'Content-Type': 'text/plain',
          })
        ).status,
        415,
      );
      assert.equal(
        (await a.post(route, { content: 'x'.repeat(17000) })).status,
        413,
      );
    }
    const key = randomUUID(),
      request = {
        revision: 0,
        action: {
          type: 'transfer',
          asset: 'USDC',
          direction: 'deposit',
          amount: 1000,
        },
      };
    const responses = await Promise.all([
      a.post('actions', request, key),
      a.post('actions', request, key),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200],
    );
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    assert.equal((await a.snapshot()).book.vault.USDC, 1000);
    assert.equal((await b.snapshot()).book.vault.USDC, 0);
    assert.equal((await a.post('actions', request)).status, 409);
    assert.equal(
      (await a.post('actions', { ...request, revision: 1 }, key)).status,
      409,
    );
    const q = (await (
      await a.post('quote', {
        revision: 1,
        terms: templateTerms('call-spread', '2025-02-07'),
      })
    ).json()) as Quote;
    assert.equal(
      (
        await b.post('actions', {
          revision: 0,
          action: { type: 'execute', quoteId: q.id },
        })
      ).status,
      409,
    );
    const executed = await a.post('actions', {
      revision: 1,
      action: { type: 'execute', quoteId: q.id },
      reserve: 0,
      price: 0,
      book: {},
    });
    assert.equal(executed.status, 200);
    const result = (await executed.json()) as VaultSnapshot;
    assert.equal(result.book.options[0].premium, q.premium);
    assert.equal(result.risk.counterpartyCash, 10);
    const stale = await Promise.all([
      a.post('actions', {
        revision: 2,
        action: {
          type: 'transfer',
          asset: 'USDC',
          direction: 'deposit',
          amount: 10,
        },
      }),
      a.post('actions', {
        revision: 2,
        action: {
          type: 'transfer',
          asset: 'USDC',
          direction: 'deposit',
          amount: 20,
        },
      }),
    ]);
    assert.deepEqual(
      stale.map((r) => r.status).sort((a, b) => a - b),
      [200, 409],
    );
    assert.equal((await a.snapshot()).revision, 3);
    assert.equal(
      await (await fetch(`${f.base}/legacy`)).text(),
      '<h1>Legacy desk</h1>',
    );
    assert.equal(await (await fetch(`${f.base}/`)).text(), '<h1>Parcel</h1>');
  } finally {
    await f.close();
  }
});
void test('vault HTTP: failed receipt persistence rolls back balances, positions, quote consumption and audit; disk restart preserves original receipt', async () => {
  const f = await fixture();
  try {
    const a = await f.client();
    await a.post('actions', {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1000,
      },
    });
    const q = (await (
      await a.post('quote', {
        revision: 1,
        terms: templateTerms('call-spread', '2025-02-07'),
      })
    ).json()) as Quote;
    const before = await a.snapshot();
    const auditBefore = f.app.store.db
      .prepare('SELECT count(*) as n FROM audit_events')
      .get();
    f.app.store.db.exec(
      "CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'audit injected receipt failure'); END;",
    );
    const key = randomUUID(),
      input = { revision: 1, action: { type: 'execute', quoteId: q.id } };
    const failed = await a.post('actions', input, key);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), {
      error: 'The request could not be completed.',
      code: 'INTERNAL',
    });
    assert.deepEqual((await a.snapshot()).book, before.book);
    assert.equal((await a.snapshot()).revision, before.revision);
    assert.deepEqual(
      f.app.store.db.prepare('SELECT count(*) as n FROM audit_events').get(),
      auditBefore,
    );
    assert.equal(
      f.app.store.db
        .prepare('SELECT consumed FROM vault_quotes WHERE id=?')
        .get(q.id)!.consumed,
      0,
    );
    f.app.store.db.exec('DROP TRIGGER fail_receipt');
    const success = await a.post('actions', input, key);
    assert.equal(success.status, 200);
    const receipt = (await success.json()) as VaultSnapshot;
    await f.restart();
    const retried = await a.post('actions', input, key);
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), receipt);
    assert.deepEqual((await a.snapshot()).book, receipt.book);
    assert.equal((await a.snapshot()).revision, 2);
    assert.deepEqual(
      f.app.store.db.prepare('PRAGMA integrity_check').get(),
      Object.assign(Object.create(null), { integrity_check: 'ok' }),
    );
  } finally {
    await f.close();
  }
});
void test('static fallback never follows an index symlink outside the public root', async () => {
  const f = await fixture();
  const secretDir = await mkdtemp(`${tmpdir()}/parcel-outside-`);
  try {
    await writeFile(`${secretDir}/outside.html`, 'must not be served');
    await rm(`${f.dir}/index.html`);
    await symlink(`${secretDir}/outside.html`, `${f.dir}/index.html`);
    for (const route of ['/', '/unknown-route']) {
      const response = await fetch(f.base + route);
      assert.ok([403, 404].includes(response.status));
      assert.doesNotMatch(await response.text(), /must not be served/);
    }
  } finally {
    await f.close();
    await rm(secretDir, { recursive: true, force: true });
  }
});
void test('migration: a real version-one SQLite database upgrades additively and reopens', async () => {
  const dir = await mkdtemp(`${tmpdir()}/parcel-migration-`);
  try {
    const db = new DatabaseSync(`${dir}/strata.sqlite`);
    db.exec(
      await readFile(
        new URL('../server/db/001-initial.sql', import.meta.url),
        'utf8',
      ),
    );
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(
      'retained',
      'hash',
      'csrf',
      0,
      9999999999999,
    );
    db.prepare('INSERT INTO portfolios VALUES(?,?,?,?)').run(
      'retained',
      7,
      '{"retained":true}',
      123,
    );
    db.close();
    const app = createApp({
      ...configFromEnv({ CHAIN_ENABLED: 'false' }),
      stateDir: dir,
    });
    assert.deepEqual(
      app.store.db
        .prepare('SELECT revision,book FROM portfolios WHERE owner=?')
        .get('retained'),
      Object.assign(Object.create(null), {
        revision: 7,
        book: '{"retained":true}',
      }),
    );
    assert.deepEqual(
      app.store.db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => r.version),
      [1, 2, 3, 4, 5],
    );
    assert.equal(
      app.vault.snapshot({
        id: 'retained',
        csrf: 'csrf',
        expires_at: 9999999999999,
      }).revision,
      0,
    );
    app.store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('product catalog HTTP: chain and sizing are guarded, revision-bound, read-only and match the funded quote', async () => {
  const f = await fixture();
  try {
    const c = await f.client(),
      before = await c.snapshot();
    const input = {
      revision: before.revision,
      expiry: '2025-02-07',
      quantity: 0.333333,
    };
    assert.equal(
      (await c.post('chain', input, randomUUID(), { 'X-CSRF-Token': 'wrong' }))
        .status,
      403,
    );
    assert.equal(
      (await c.post('chain', { ...input, revision: 12 })).status,
      409,
    );
    assert.equal(
      (await c.post('chain', { ...input, quantity: 0.3333333 })).status,
      409,
    );
    const chain = await c.post('chain', input);
    assert.equal(chain.status, 200);
    const payload = (await chain.json()) as {
      rows: { strike: number }[];
      spot: number;
    };
    const strikes = payload.rows.map((r) => r.strike);
    assert.ok(strikes.length > 15);
    assert.deepEqual(strikes, [...strikes].sort((a, b) => a - b));
    assert.ok(strikes.some((k) => k % 5 !== 0), 'lists half-step strikes');
    assert.ok(strikes[0] < payload.spot && strikes.at(-1)! > payload.spot);
    const size = await c.post('size', {
      revision: before.revision,
      terms: templateTerms('quadratic', '2025-01-24T01:00:00Z'),
      mode: 'premium',
      target: 2,
    });
    assert.equal(size.status, 200);
    const sized = (await size.json()) as {
      terms: Quote['terms'];
      premium: number;
      cashFunding: number;
    };
    const quoteResponse = await c.post('quote', {
      revision: before.revision,
      terms: sized.terms,
    });
    assert.equal(quoteResponse.status, 200);
    const quote = (await quoteResponse.json()) as Quote;
    assert.equal(quote.premium, sized.premium);
    assert.equal(quote.eligible, false);
    const after = await c.snapshot();
    assert.deepEqual(after.book, before.book);
    assert.equal(after.revision, before.revision);
    const other = await f.client();
    assert.equal(
      (
        await other.post('actions', {
          revision: 0,
          action: { type: 'execute', quoteId: quote.id },
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});
