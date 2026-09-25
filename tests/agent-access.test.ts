import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
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

void test('oauth: an MCP app registers, the owner allows, and the code becomes a key once', async () => {
  const f = await fixture();
  try {
    const d = await f.desk();
    // /mcp without a key points at the metadata that starts the flow.
    const bare = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(bare.status, 401);
    const meta = /resource_metadata="([^"]+)"/.exec(
      bare.headers.get('www-authenticate') ?? '',
    )?.[1];
    assert.ok(meta);
    const resource = (await (await fetch(meta)).json()) as {
      authorization_servers: string[];
    };
    const server = (await (
      await fetch(
        `${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`,
      )
    ).json()) as Record<string, string>;

    const redirect = 'http://localhost:9999/callback';
    const registered = (await (
      await fetch(server.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [redirect],
        }),
      })
    ).json()) as { client_id: string };
    const refused = await fetch(server.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    assert.equal(refused.status, 400, 'plain http only back to localhost');

    const verifier = randomUUID() + randomUUID();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const page = await fetch(
      `${server.authorization_endpoint}?${new URLSearchParams({
        response_type: 'code',
        client_id: registered.client_id,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 's1',
      })}`,
    );
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Claude wants to use your Parcel vault/);

    const approved = (await (
      await fetch(`${f.base}/api/oauth/approve`, {
        method: 'POST',
        headers: d.headers,
        body: JSON.stringify({
          clientId: registered.client_id,
          redirectUri: redirect,
          challenge,
          state: 's1',
        }),
      })
    ).json()) as { redirect: string };
    const back = new URL(approved.redirect);
    assert.equal(back.searchParams.get('state'), 's1');
    const code = back.searchParams.get('code')!;

    const exchange = (v: string) =>
      fetch(server.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          client_id: registered.client_id,
          code_verifier: v,
        }),
      });
    assert.equal((await exchange('wrong-verifier')).status, 400);
    // A failed attempt spends the code too.
    assert.equal((await exchange(verifier)).status, 400);

    // A fresh approval, exchanged correctly, connects.
    const again = new URL(
      (
        (await (
          await fetch(`${f.base}/api/oauth/approve`, {
            method: 'POST',
            headers: d.headers,
            body: JSON.stringify({
              clientId: registered.client_id,
              redirectUri: redirect,
              challenge,
            }),
          })
        ).json()) as { redirect: string }
      ).redirect,
    ).searchParams.get('code')!;
    const token = (await (
      await fetch(server.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: again,
          redirect_uri: redirect,
          client_id: registered.client_id,
          code_verifier: verifier,
        }),
      })
    ).json()) as { access_token: string };
    const keys = await d.keys();
    assert.equal(keys.length, 1);
    assert.equal((keys[0] as { label?: string }).label, 'Claude');

    const client = new Client({ name: 'Claude', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), {
        requestInit: { headers: bearer(token.access_token) },
      }),
    );
    const got = await client.callTool({ name: 'get_vault', arguments: {} });
    assert.ok(!got.isError);
    await client.close();

    // An approval needs the desk's CSRF token, so another site cannot
    // click Allow on the owner's behalf.
    const forged = await fetch(`${f.base}/api/oauth/approve`, {
      method: 'POST',
      headers: { ...d.headers, 'X-CSRF-Token': 'nope' },
      body: JSON.stringify({
        clientId: registered.client_id,
        redirectUri: redirect,
        challenge,
      }),
    });
    assert.equal(forged.status, 403);
  } finally {
    await f.close();
  }
});

void test('oauth: a configured public address is what agents are told', async () => {
  const cfg = configFromEnv({
    CHAIN_ENABLED: 'false',
    PUBLIC_URL: 'https://parcel.example.com/',
  });
  assert.equal(cfg.publicUrl, 'https://parcel.example.com');
  assert.throws(
    () => configFromEnv({ CHAIN_ENABLED: 'false', PUBLIC_URL: 'http://x.io' }),
    /https/,
  );
});

void test('skill: the desk serves /parcel, and plugin suffixes leave app names', async () => {
  const f = await fixture();
  try {
    const skill = await (
      await fetch(`${f.base}/claude/parcel/SKILL.md`)
    ).text();
    assert.match(skill, /^---\nname: parcel\n/);

    // Claude Code registers a plugin's server with a suffix the owner
    // should not have to read.
    const registered = await fetch(`${f.base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude Code (plugin:parcel:parcel)',
        redirect_uris: ['http://localhost:9999/callback'],
      }),
    });
    assert.equal(
      ((await registered.json()) as { client_name: string }).client_name,
      'Claude Code',
    );
  } finally {
    await f.close();
  }
});

void test('wallet: a signed challenge signs the session in; a wrong signature does not', async () => {
  const f = await fixture();
  try {
    const d = await f.desk();
    const before = (await (
      await fetch(`${f.base}/api/wallet`, { headers: d.headers })
    ).json()) as { required: boolean; address: string | null };
    assert.deepEqual(before, { required: true, address: null });

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const address = new PublicKey(raw).toBase58();
    const challenge = async () =>
      (
        (await (
          await fetch(`${f.base}/api/wallet/challenge`, {
            method: 'POST',
            headers: d.headers,
            body: '{}',
          })
        ).json()) as { message: string }
      ).message;
    const signIn = (signature: Buffer) =>
      fetch(`${f.base}/api/wallet/signin`, {
        method: 'POST',
        headers: d.headers,
        body: JSON.stringify({
          address,
          signature: signature.toString('base64'),
        }),
      });

    // Signed by another key: refused.
    const other = generateKeyPairSync('ed25519').privateKey;
    const forged = sign(null, Buffer.from(await challenge()), other);
    assert.equal((await signIn(forged)).status, 401);

    const good = sign(null, Buffer.from(await challenge()), privateKey);
    assert.equal((await signIn(good)).status, 200);
    const after = (await (
      await fetch(`${f.base}/api/wallet`, { headers: d.headers })
    ).json()) as { address: string | null };
    assert.equal(after.address, address);

    await fetch(`${f.base}/api/wallet/signout`, {
      method: 'POST',
      headers: d.headers,
      body: '{}',
    });
    const out = (await (
      await fetch(`${f.base}/api/wallet`, { headers: d.headers })
    ).json()) as { address: string | null };
    assert.equal(out.address, null);
  } finally {
    await f.close();
  }
});
