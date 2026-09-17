import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const base = process.env.STRATA_URL;
if (!base) throw Error('Set STRATA_URL to the private VPS deployment.');
const initial = await fetch(`${base}/api/session`),
  cookie = initial.headers.get('set-cookie').split(';')[0],
  session = await initial.json();
const key = randomUUID(),
  request = JSON.stringify({
    revision: session.revision,
    action: {
      type: 'request',
      terms: {
        kind: 'put',
        low: 120,
        high: 140,
        quantity: 100,
        premium: 400,
        expiry: '2025-01-27',
        scenario: 'deepseek',
      },
    },
  });
const headers = {
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf,
  'Idempotency-Key': key,
};
const firstResponse = await fetch(`${base}/api/portfolio/actions`, {
  method: 'POST',
  headers,
  body: request,
});
assert.equal(firstResponse.status, 200);
const first = await firstResponse.json();
const vaultBefore = await (
  await fetch(`${base}/api/vault`, { headers: { Cookie: cookie } })
).json();
const vaultKey = randomUUID();
const vaultRequest = JSON.stringify({
  revision: vaultBefore.revision,
  action: {
    type: 'transfer',
    direction: 'deposit',
    asset: 'USDC',
    amount: 250,
  },
});
const vaultHeaders = { ...headers, 'Idempotency-Key': vaultKey };
const vaultResponse = await fetch(`${base}/api/vault/actions`, {
  method: 'POST',
  headers: vaultHeaders,
  body: vaultRequest,
});
assert.equal(vaultResponse.status, 200);
const vaultFirst = await vaultResponse.json();
execFileSync('ssh', ['trading-01', 'sudo systemctl restart stocklana-web']);
let health;
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(`${base}/api/ready`);
    if (r.ok) {
      health = await r.json();
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
assert.ok(health?.chain.ready);
const restored = await (
  await fetch(`${base}/api/portfolio`, { headers: { Cookie: cookie } })
).json();
assert.deepEqual(restored.book, first.book);
assert.equal(restored.revision, first.revision);
const retry = await fetch(`${base}/api/portfolio/actions`, {
  method: 'POST',
  headers,
  body: request,
});
assert.equal(retry.status, 200);
assert.deepEqual(await retry.json(), first);
const vaultRestored = await (
  await fetch(`${base}/api/vault`, { headers: { Cookie: cookie } })
).json();
assert.deepEqual(vaultRestored.book, vaultFirst.book);
assert.deepEqual(vaultRestored.risk, vaultFirst.risk);
assert.equal(vaultRestored.revision, vaultFirst.revision);
const vaultRetry = await fetch(`${base}/api/vault/actions`, {
  method: 'POST',
  headers: vaultHeaders,
  body: vaultRequest,
});
assert.equal(vaultRetry.status, 200);
assert.deepEqual(await vaultRetry.json(), vaultFirst);
const result = {
  checkedAt: new Date().toISOString(),
  checks: [
    'Same cookie resumes after systemd service restart',
    'Legacy portfolio and revision unchanged',
    'Parcel vault assets, collateral and revision unchanged',
    'Parcel deposit retry returns the original durable receipt',
    'Same mutation key returns original durable receipt',
    'Database, pinned program, mint and Solana clock ready',
  ],
  health,
};
await writeFile(
  'docs/audit/parcel-deployment-checks.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(result);
