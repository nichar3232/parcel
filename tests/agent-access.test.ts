import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app';
import { configFromEnv } from '../server/config';
import type { VaultSnapshot } from '../lib/parcel/types';

async function fixture() {
  const dir = await mkdtemp(`${tmpdir()}/parcel-agent-`);
  await writeFile(`${dir}/index.html`, '<h1>Parcel</h1>');
  const app = createApp({
    ...configFromEnv({ CHAIN_ENABLED: 'false' }),
    stateDir: `${dir}/state`,
    publicDir: dir,
    port: 0,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, '127.0.0.1', resolve),
  );
  const addr = app.server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = `http://127.0.0.1:${addr.port}`;
  const desk = async () => {
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
      createKey: () =>
        fetch(`${base}/api/agent/keys`, { method: 'POST', headers }),
      keys: async () =>
        (
          (await (
            await fetch(`${base}/api/agent/keys`, { headers })
          ).json()) as { keys: { id: string; hint: string }[] }
        ).keys,
      revoke: (id: string) =>
        fetch(`${base}/api/agent/keys/${id}/revoke`, {
          method: 'POST',
          headers,
        }),
      vault: async () =>
        (await (
          await fetch(`${base}/api/vault`, { headers })
        ).json()) as VaultSnapshot,
    };
  };
  return {
    base,
    desk,
    async close() {
      await new Promise<void>((resolve, reject) =>
        app.server.close((e) => (e ? reject(e) : resolve())),
      );
      app.store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const bearer = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
});

void test('agent keys: created from the desk, act for its vault only, marked as the agent, and revocable', async () => {
  const f = await fixture();
  try {
    const a = await f.desk(),
      b = await f.desk();
    // A key needs the desk's CSRF token to create.
    assert.equal(
      (
        await fetch(`${f.base}/api/agent/keys`, {
          method: 'POST',
          headers: { ...a.headers, 'X-CSRF-Token': 'wrong' },
        })
      ).status,
      403,
    );
    const created = (await (await a.createKey()).json()) as {
      key: string;
      agentKey: { id: string; hint: string };
    };
    assert.match(created.key, /^pk_agent_[a-f0-9]{64}$/);
    assert.deepEqual(
      (await a.keys()).map((k) => k.hint),
      [created.key.slice(-4)],
    );
    assert.deepEqual(await b.keys(), []);

    // The key reads and trades a's vault, without cookie or CSRF token.
    const start = (await (
      await fetch(`${f.base}/api/vault`, { headers: bearer(created.key) })
    ).json()) as VaultSnapshot;
    assert.equal(start.revision, (await a.vault()).revision);
    const traded = await fetch(`${f.base}/api/vault/actions`, {
      method: 'POST',
      headers: { ...bearer(created.key), 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        revision: start.revision,
        action: {
          type: 'transfer',
          asset: 'USDC',
          direction: 'deposit',
          amount: 100,
        },
      }),
    });
    assert.equal(traded.status, 200, await traded.clone().text());
    // Marked by the key, although the request did not say so itself.
    assert.equal((await a.vault()).book.events[0].via, 'agent');
    assert.equal((await b.vault()).revision, 0);

    // A key cannot reach historical desk endpoints, where its activity would
    // not carry the vault action's explicit agent provenance.
    for (const path of ['/api/portfolio/actions', '/api/chain/action']) {
      const legacy = await fetch(`${f.base}${path}`, {
        method: 'POST',
        headers: { ...bearer(created.key), 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({}),
      });
      assert.equal(legacy.status, 403, await legacy.text());
    }

    // A key cannot manage keys, and b cannot revoke a's.
    assert.equal(
      (
        await fetch(`${f.base}/api/agent/keys`, {
          headers: bearer(created.key),
        })
      ).status,
      403,
    );
    assert.equal((await b.revoke(created.agentKey.id)).status, 404);
    assert.equal((await a.revoke(created.agentKey.id)).status, 200);
    assert.equal(
      (await fetch(`${f.base}/api/vault`, { headers: bearer(created.key) }))
        .status,
      401,
    );

    for (let i = 0; i < 5; i++) assert.equal((await a.createKey()).status, 200);
    assert.equal((await a.createKey()).status, 409);
  } finally {
    await f.close();
  }
});

void test('/mcp: an MCP client with an agent key uses the vault; without one it is refused', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await fetch(`${f.base}/mcp`, { method: 'POST' })).status,
      401,
    );
    const a = await f.desk();
    const { key } = (await (await a.createKey()).json()) as { key: string };
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('trade_stock') && tools.includes('get_vault'));
    const r = (await client.callTool({
      name: 'transfer',
      arguments: { direction: 'deposit', asset: 'USDC', amount: 100 },
    })) as { isError?: boolean; content: { text: string }[] };
    assert.ok(!r.isError, r.content[0].text);
    assert.equal(
      JSON.parse(r.content[0].text).settledIn,
      'sandbox (not onchain)',
    );
    const v = await a.vault();
    assert.equal(v.revision, 1);
    assert.equal(v.book.events[0].via, 'agent');
    await client.close();
  } finally {
    await f.close();
  }
});
