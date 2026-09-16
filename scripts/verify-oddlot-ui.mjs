import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const baseURL = process.env.ODDLOT_URL;
if (!baseURL) throw Error('Set ODDLOT_URL.');
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {},
);
const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('/app');
  await expect(page.locator('.oddlot')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Deposit USDC', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('500');
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390)
      await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Activity', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Confirmed on Solana localnet' }),
    ).toBeVisible();
    if (width === 390)
      await expect
        .poll(() =>
          page
            .locator('.od-sidebar')
            .evaluate((e) => e.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `docs/audit/2026-09-15-release/chain-${width}.png`,
      fullPage: true,
    });
  }
  const snapshot = await (await page.request.get('/api/vault')).json();
  const proof = await (
    await page.request.get(`/api/chain/tx/${snapshot.chain.signature}`)
  ).json();
  assertProof(proof);
  const rejection = await page.request.post('/api/vault/actions', {
    headers: {
      'X-CSRF-Token': snapshot.csrf,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: {
      revision: snapshot.revision,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'withdraw',
        amount: 1000,
      },
    },
  });
  expect(rejection.status()).toBe(409);
  const after = await (await page.request.get('/api/vault')).json();
  expect(after.revision).toBe(snapshot.revision);
  await writeFile(
    'docs/audit/2026-09-15-release/ui-integration.json',
    JSON.stringify(
      {
        mode: snapshot.mode,
        chain: snapshot.chain,
        proof,
        invalidWithdrawalStatus: rejection.status(),
        widths: [1440, 390],
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  expect(errors).toEqual([]);
  console.log(
    'Actual localnet UI, proof route, mobile layout and rejected intent verified.',
  );
} finally {
  await context.close();
  await browser.close();
}
function assertProof(proof) {
  expect(proof.network).toBe('localnet');
  expect(proof.error).toBeNull();
  expect(proof.logs.join('\n')).toContain(
    'CJxu36zhuU2Hx1BFisJdSQwdXoUkakA2UJ2WPxeT97af',
  );
}
