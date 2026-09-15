import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { configFromEnv } from '../server/config';
import { Store } from '../server/db/store';
import type { ChainPosition, SessionPortfolio } from '../lib/contracts/api';
const config = configFromEnv(),
  app = createApp(
    { ...config, host: '127.0.0.1', port: 0, expirySeconds: 30 },
    { store: new Store(`${config.stateDir}/audit.sqlite`) },
  );
await new Promise<void>((resolve) =>
  app.server.listen(0, '127.0.0.1', resolve),
);
const address = app.server.address();
assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
const checks: string[] = [],
  positions: ChainPosition[] = [];
try {
  const start = await fetch(`${base}/api/session`),
    cookie = start.headers.get('set-cookie')!,
    session = (await start.json()) as SessionPortfolio;
  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    'X-CSRF-Token': session.csrf,
  };
  async function post(input: unknown, key = randomUUID()) {
    const r = await fetch(`${base}/api/chain/action`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(input),
    });
    const value = await r.json();
    assert.equal(r.status, 200, JSON.stringify(value));
    return value as ChainPosition;
  }
  async function confirmed(p: ChainPosition) {
    for (let i = 0; p.pending && i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const response = await fetch(`${base}/api/chain/positions/${p.id}`, {
        headers: { Cookie: cookie },
      });
      p = (await response.json()) as ChainPosition;
    }
    assert.equal(p.pending, false, JSON.stringify(p));
    assert.equal(p.warning, undefined);
    return p;
  }
  const cases = [
    {
      scenario: 'deepseek',
      kind: 'put',
      low: 120,
      high: 140,
      premium: 400,
      quantity: 100,
      expiry: '2025-01-27',
      payout: 2000,
    },
    {
      scenario: 'earnings',
      kind: 'put',
      low: 115,
      high: 130,
      premium: 350,
      quantity: 100,
      expiry: '2025-02-27',
      payout: 985,
    },
    {
      scenario: 'rebound',
      kind: 'call',
      low: 130,
      high: 145,
      premium: 0.123456,
      quantity: 0.333333,
      expiry: '2025-01-22',
      payout: 4.999995,
    },
  ];
  for (const c of cases) {
    const { payout, ...terms } = c,
      key = randomUUID();
    let p = await confirmed(await post({ action: 'fund', terms }, key));
    assert.equal(p.status, 'funded');
    const again = await post({ action: 'fund', terms }, key);
    assert.equal(again.id, p.id);
    assert.equal(again.transactions.length, 1);
    checks.push(
      `${c.scenario}: duplicate fund returns same signed transaction`,
    );
    p = await confirmed(await post({ action: 'accept', id: p.id }));
    assert.equal(p.status, 'active');
    positions.push(p);
    console.log(c.scenario, 'accepted', p.id, p.expiry, payout);
  }
  const foreign = await fetch(`${base}/api/session`),
    foreignCookie = foreign.headers.get('set-cookie')!;
  const read = await fetch(`${base}/api/chain/positions/${positions[0].id}`, {
    headers: { Cookie: foreignCookie },
  });
  assert.equal(read.status, 404);
  checks.push('Cross-session contract access denied');
  const latest = Math.max(...positions.map((p) => p.expiry));
  let observedTime = 0;
  for (let attempts = 0; attempts < 180; attempts++) {
    const response = await fetch(
      `${base}/api/chain/positions/${positions.at(-1)!.id}`,
      { headers: { Cookie: cookie } },
    );
    const observation = (await response.json()) as ChainPosition;
    observedTime = observation.chainTime || 0;
    if (observedTime >= latest) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(observedTime >= latest, 'Solana clock did not reach expiry.');
  for (let i = 0; i < positions.length; i++) {
    let p = positions[i];
    if (i === 0) {
      p = await confirmed(
        await post({ action: 'settle', id: p.id, missing: true }),
      );
      assert.equal(p.status, 'awaiting');
      assert.equal(p.escrow, 2000);
      checks.push('Missing observation preserves entire reserve');
    }
    p = await confirmed(
      await post({ action: 'settle', id: p.id, missing: false }),
    );
    assert.equal(p.status, 'settled');
    assert.equal(p.buyerPayout, cases[i].payout);
    p = await confirmed(await post({ action: 'claim-holder', id: p.id }));
    assert.equal(p.buyerClaimed, true);
    p = await confirmed(await post({ action: 'claim-maker', id: p.id }));
    assert.equal(p.status, 'closed');
    assert.equal(p.escrow, 0);
    positions[i] = p;
    checks.push(
      `${cases[i].scenario}: exact payout ${p.buyerPayout}; both claims; empty escrow`,
    );
    console.log(cases[i].scenario, 'closed', p.buyerPayout);
  }
  const evidence = {
    completedAt: new Date().toISOString(),
    network: config.network,
    programId: config.programId,
    checks,
    positions,
    transactions: positions.flatMap((p) => p.transactions),
  };
  await writeFile(
    `${config.stateDir}/audit-interactive-evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({ checks, transactions: evidence.transactions.length }),
  );
} finally {
  await new Promise<void>((r) => app.server.close(() => r()));
  app.store.close();
}
