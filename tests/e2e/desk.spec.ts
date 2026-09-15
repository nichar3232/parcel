import { test, expect, type Page } from '@playwright/test';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  await page.goto('/legacy');
  await expect(
    page.getByText('Connecting to your saved portfolio…'),
  ).toHaveCount(0);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
async function fund(page: Page) {
  await page
    .getByRole('button', { name: 'Protect a position', exact: true })
    .click();
  await page.getByRole('button', { name: 'Request a funded quote' }).click();
  await expect(
    page.getByRole('heading', { name: 'Maker workspace' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fund offer · $2,000.00' }).click();
  await page.getByRole('button', { name: 'Review as holder' }).click();
}
test('complete historical lifecycle through the real backend, reload and both claims', async ({
  page,
}) => {
  await fund(page);
  await expect(page.getByRole('dialog')).toContainText('$2,000.00');
  await page.getByRole('button', { name: /Accept.*400/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Active');
  await page.getByRole('button', { name: 'Advance to expiry' }).click();
  await page
    .getByRole('button', { name: 'Settle position', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Settled at $118.42');
  await page
    .getByRole('button', { name: 'Claim as holder · $2,000.00' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Holder claimed' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Claim as maker · $0.00' }).click();
  await expect(page.getByRole('dialog')).toContainText('Closed');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByText('$11,600.00').first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/audit/screenshots/settled-portfolio.png',
    fullPage: true,
  });
  const p = await page.request.get('/api/portfolio');
  const view = await p.json();
  expect(view.book.positions[0].status).toBe('closed');
  expect(view.book.holderCash + view.book.makerCash).toBe(60000);
});
test('maker cancellation reclaims reserve and invalid builder inputs never crash', async ({
  page,
}) => {
  await fund(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel & reclaim' }).click();
  await expect(page.getByText('$50,000.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.locator('#quantity').fill('0');
  await expect(
    page.getByRole('button', { name: 'Request a funded quote' }),
  ).toBeDisabled();
  await expect(page.locator('.form-error')).toBeVisible();
  await page.locator('#quantity').fill('100');
  await page.locator('#premium').fill('2500');
  await expect(page.locator('.form-error')).toContainText(
    'Premium cannot exceed',
  );
  await page.screenshot({
    path: 'test-results/audit/screenshots/build-validation.png',
    fullPage: true,
  });
});
test('a stale second tab cannot overwrite a newer portfolio', async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await second.goto('/legacy');
  await expect(
    second.getByText('Connecting to your saved portfolio…'),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Protect a position', exact: true })
    .click();
  await page.getByRole('button', { name: 'Request a funded quote' }).click();
  await expect(
    page.getByRole('heading', { name: 'Maker workspace' }),
  ).toBeVisible();
  await second
    .getByRole('button', { name: 'Protect a position', exact: true })
    .click();
  await second.getByRole('button', { name: 'Request a funded quote' }).click();
  await expect(second.locator('.toast')).toContainText('portfolio changed');
  const result = await second.request.get('/api/portfolio');
  expect((await result.json()).book.positions).toHaveLength(1);
  await second.close();
});
test('backend failure is visible and reconnect restores the session', async ({
  page,
}) => {
  await page.route('**/api/session', (r) => r.abort());
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Reconnect', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.locator('.connection-banner')).toHaveCount(0);
});
test('all views and dialogs work at desktop and mobile widths without page overflow', async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      'Trade',
      'Build',
      'Finance',
      'Activity',
      'Maker',
      'Replay lab',
      'Portfolio',
    ]) {
      await page
        .getByRole('button', { name: new RegExp('^' + name + '(?:\\s|$)') })
        .first()
        .click();
      await expect(page.locator('h1')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/audit/screenshots/${name.toLowerCase().replaceAll(' ', '-')}-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Demo wallet' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('missing historical observation keeps the reserve locked and recovery pays once', async ({
  page,
}) => {
  await fund(page);
  await page.getByRole('button', { name: /Accept.*400/ }).click();
  await page.getByRole('button', { name: 'Advance to expiry' }).click();
  await page.getByLabel('Simulate missing oracle data').check();
  await page
    .getByRole('button', { name: 'Settle position', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Awaiting data');
  const response = await page.request.get('/api/portfolio');
  expect((await response.json()).book.positions[0].buyerPayout).toBe(0);
  await page.getByLabel('Simulate missing oracle data').uncheck();
  await page.getByRole('button', { name: 'Retry settlement' }).click();
  await expect(page.getByRole('dialog')).toContainText('Settled at $118.42');
  await page.screenshot({
    path: 'test-results/audit/screenshots/recovered-settlement.png',
    fullPage: true,
  });
});
test('a dropped mutation response retries the same request without a second quote', async ({
  page,
}) => {
  let dropped = false;
  await page.route('**/api/portfolio/actions', async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Protect a position', exact: true })
    .click();
  await page.getByRole('button', { name: 'Request a funded quote' }).click();
  await expect(
    page.getByRole('heading', { name: 'Maker workspace' }),
  ).toBeVisible();
  const response = await page.request.get('/api/portfolio');
  expect((await response.json()).book.positions).toHaveLength(1);
});

test('settlement uses the chain clock even when wall time is far ahead', async ({
  page,
}) => {
  let chainTime = 1000;
  const position = () => ({
    id: 'clock-fixture',
    network: 'localnet',
    programId: 'test-program',
    mint: 'test-mint',
    holder: 'test-holder',
    maker: 'test-maker',
    offer: 'test-offer',
    vault: 'test-vault',
    market: 'test-market',
    terms: {
      kind: 'put',
      low: 120,
      high: 140,
      quantity: 100,
      premium: 400,
      expiry: '2025-01-27',
      scenario: 'deepseek',
    },
    nonce: '1',
    expiry: 1010,
    deadline: 1005,
    historicalAt: 1738011600,
    price: 118.42,
    transactions: [],
    status: 'active',
    buyerPayout: 0,
    buyerClaimed: false,
    makerClaimed: false,
    escrow: 2000,
    lastSlot: 10,
    updatedAt: new Date().toISOString(),
    chainTime,
  });
  await page.route('**/api/chain/positions**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/positions')
        ? [position()]
        : position(),
    }),
  );
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        app: 'strata',
        database: 'ready',
        chain: { ready: true, network: 'localnet', chainTime },
        serverTime: Date.now(),
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText('Connecting to your saved portfolio…'),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Protect a position', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Try this contract on Solana' })
    .click();
  await expect(page.getByText('10 chain seconds')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Settle on Solana' }),
  ).toBeDisabled();
  chainTime = 1010;
  await expect(
    page.getByRole('button', { name: 'Settle on Solana' }),
  ).toBeEnabled({ timeout: 15000 });
});
