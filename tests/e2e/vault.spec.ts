import { test, expect, type Page } from '@playwright/test';
import {
  advance,
  advanced,
  deposit,
  execute,
  nav,
  openDesk,
} from './desk-helpers';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  await openDesk(page);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('vault deposits, fractional covered underwriting, blocked withdrawal and expiry persist through reload', async ({
  page,
}) => {
  await deposit(page, 'NVDA', '0.333333');
  await deposit(page, 'USDC', '200');
  await nav(page, 'Underwrite');
  await advanced(page);
  await page.screenshot({
    path: 'test-results/audit/2026-09-15-review/invalid-terms.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Contract quantity').fill('0.333333');
  await page.getByLabel('Leg 1 strike', { exact: true }).fill('100');
  await page
    .getByLabel('Expiration', { exact: true })
    .selectOption('2025-01-27');
  await execute(page);
  await nav(page, 'Positions');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'Covered call' })
      .getByRole('cell', { name: '0.333333', exact: true }),
  ).toBeVisible();
  await nav(page, 'Vault');
  await page
    .getByRole('button', { name: 'Withdraw NVDA', exact: true })
    .click();
  await page.getByLabel('Amount', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Confirm withdraw' }).click();
  await expect(page.locator('.od-toast')).toContainText('more available NVDA');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await advance(page, '2025-01-27');
  await page.reload();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
  await nav(page, 'Activity');
  await expect(page.getByText('Expiry settled', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Contract opened', { exact: true }),
  ).toBeVisible();
});
test('structured orders release only valid collateral offsets; risk view stays synchronized', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await nav(page, 'Structures');
  await page
    .getByRole('button', { name: /DEFINED DOWNSIDE Put spread/ })
    .click();
  await execute(page);
  await advanced(page);
  await page.getByLabel('Leg 1 side', { exact: true }).selectOption('sell');
  await page.getByLabel('Leg 2 side', { exact: true }).selectOption('buy');
  await execute(page);
  await nav(page, 'Risk');
  await expect(
    page.locator('.od-stat').filter({ hasText: 'Released by offsets' }),
  ).toContainText('$10.00');
  await page
    .getByRole('button', { name: 'Isolated collateral', exact: true })
    .click();
  await expect(
    page.locator('.od-stat').filter({ hasText: 'Released by offsets' }),
  ).toContainText('$0.00');
  await page.reload();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
  await nav(page, 'Risk');
  await expect(
    page.getByRole('button', { name: 'Isolated collateral', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});
test('lending, recall and a protected short complete through the real API', async ({
  page,
}) => {
  await deposit(page, 'NVDA', '5');
  await deposit(page, 'USDC', '500');
  await nav(page, 'Lending');
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await page.getByRole('button', { name: 'Review stock loan' }).click();
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Lending positions');
  await expect(
    page.getByRole('button', { name: 'Recall shares' }),
  ).toBeVisible();
  await advance(page, '2025-01-27');
  await page.getByRole('button', { name: 'Recall shares' }).click();
  await expect(page.getByRole('dialog')).toContainText('Interest you receive');
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recall shares' })).toHaveCount(
    0,
  );
  await nav(page, 'Lending');
  await page.getByRole('button', { name: 'Short', exact: true }).click();
  await page.getByLabel('Protective call strike').fill('120');
  await page.getByRole('button', { name: 'Review protected short' }).click();
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advance(page, '2025-01-28');
  await nav(page, 'Lending positions');
  await page.getByRole('button', { name: 'Cover & repay' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'You pay to cover and repay',
  );
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cover & repay' })).toHaveCount(
    0,
  );
  await nav(page, 'Activity');
  await expect(
    page.getByText('Protected short closed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Lent shares returned', { exact: true }),
  ).toBeVisible();
});
test('dividend contracts execute and settle from the stored event', async ({
  page,
}) => {
  await deposit(page, 'USDC', '10');
  await nav(page, 'Structures');
  await page.getByRole('button', { name: 'Dividends', exact: true }).click();
  await page
    .getByRole('button', { name: /DIVIDEND EVENT Dividend call spread/ })
    .click();
  await execute(page);
  await advance(page, '2025-03-12');
  await expect(
    page.getByRole('cell', { name: 'Dividend call spread', exact: true }),
  ).toHaveCount(0);
  await nav(page, 'Activity');
  await expect(page.getByText('Expiry settled', { exact: true })).toBeVisible();
});
test('every workspace view fits desktop and mobile, with accessible forms and no page overflow', async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Portfolio', 'Trade', 'Pre-IPO', 'Lending']) {
      await nav(page, name);
      await expect(page.locator('h1')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `test-results/audit/oddlot/${name.toLowerCase()}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await nav(page, 'Trade');
  await page.getByLabel('Contract quantity').fill('');
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeDisabled();
  await page.getByLabel('Contract quantity').fill('0.5');
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeEnabled();
});
test('a dropped mutation response retries once with the same receipt, not another deposit', async ({
  page,
}) => {
  let drop = true;
  await page.route('**/api/vault/actions', async (route) => {
    if (drop) {
      drop = false;
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await deposit(page, 'USDC', '100');
  await nav(page, 'Activity');
  await expect(page.getByText('Vault deposit', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
  await nav(page, 'Vault');
  await expect(page.locator('.od-open-head')).toContainText('$100.00');
});
test('a second tab cannot overwrite the first tab’s vault revision', async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await second.goto('/app');
  await expect(second.locator('.pc-desk')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await nav(second, 'Vault');
  await second
    .getByRole('button', { name: 'Deposit USDC', exact: true })
    .click();
  await second.getByLabel('Amount', { exact: true }).fill('200');
  await deposit(page, 'USDC', '100');
  await second
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(second.locator('.od-toast')).toContainText('vault changed');
  await second.getByRole('button', { name: 'Close dialog' }).click();
  await expect(second.locator('.od-open-head')).toContainText('$100.00');
  await second.close();
});
test('backend outage shows a recovery action and reconnect resumes the saved vault', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await page.route('**/api/vault', (r) => r.abort('connectionrefused'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await page.unroute('**/api/vault');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
  await nav(page, 'Vault');
  await expect(page.locator('.od-open-head')).toContainText('$100.00');
});

test('invalid precision and out-of-range strikes never crash the payoff view', async ({
  page,
}) => {
  await nav(page, 'Trade');
  for (const quantity of ['0.0000001', '0.3333333', '1001']) {
    await page.getByLabel('Contract quantity').fill(quantity);
    await expect(
      page.getByRole('button', { name: 'Review funded quote' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'Choose valid terms' }),
    ).toBeVisible();
    await expect(page.locator('.pc-desk')).toHaveAttribute(
      'data-ready',
      'true',
    );
  }
  await page.screenshot({
    path: 'test-results/audit/2026-09-15-review/invalid-terms.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Contract quantity').fill('0.333333');
  await advanced(page);
  await page.getByLabel('Leg 1 strike', { exact: true }).fill('10000000000');
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeDisabled();
  await page.getByLabel('Leg 1 strike', { exact: true }).fill('145');
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeEnabled();
  await expect(
    page.getByLabel('Option profit and loss across underlying prices'),
  ).toBeVisible();
});
test('a delayed quote cannot replace edited contract terms', async ({
  page,
}) => {
  await deposit(page, 'USDC', '500');
  await nav(page, 'Trade');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const received = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/api/vault/quote', async (route) => {
    const response = await route.fetch();
    requested();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await received;
  await page.getByLabel('Contract quantity').fill('0.25');
  release();
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/api/vault/quote');
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '0.25 share-equivalents',
  );
  await page
    .getByRole('button', { name: 'Confirm contract', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Positions');
  await expect(
    page.getByRole('cell', { name: '0.25', exact: true }),
  ).toBeVisible();
});
test('two lost responses survive reload and resolve the original deposit exactly once', async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route('**/api/vault/actions', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length <= 2) {
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Deposit USDC', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('100');
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.locator('.od-toast')).toContainText(
    'Confirmation is pending',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Resolve saved action' }),
  ).toBeVisible();
  await nav(page, 'Vault');
  await page.getByRole('button', { name: 'Deposit USDC', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('200');
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.locator('.od-toast')).toContainText(
    'Resolve the saved action',
  );
  expect(keys).toHaveLength(2);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({
    path: 'test-results/audit/2026-09-15-review/recovery.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Resolve saved action' }).click();
  await expect(
    page.getByRole('button', { name: 'Resolve saved action' }),
  ).toHaveCount(0);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  await nav(page, 'Vault');
  await expect(page.locator('.od-open-head')).toContainText('$100.00');
  await nav(page, 'Activity');
  await expect(page.getByText('Vault deposit', { exact: true })).toHaveCount(1);
});
test('an unreadable success response recovers using the same idempotency key', async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route('**/api/vault/actions', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      await route.fetch();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{truncated',
      });
    } else await route.continue();
  });
  await deposit(page, 'USDC', '100');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await nav(page, 'Activity');
  await expect(page.getByText('Vault deposit', { exact: true })).toHaveCount(1);
});
test('a delayed response from an old session cannot replace the new session vault', async ({
  page,
  context,
}) => {
  await deposit(page, 'USDC', '25');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const received = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/api/vault/actions', async (route) => {
    const response = await route.fetch();
    requested();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Deposit USDC', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('100');
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await received;
  const old = await page.request.get('/api/vault');
  const { csrf } = await old.json();
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(
      async () => (await (await page.request.get('/api/vault')).json()).csrf,
    )
    .not.toBe(csrf);
  // Wait for the new snapshot to reach React before releasing the old response.
  await expect(page.locator('.od-open-head')).toContainText('$0.00');
  release();
  await expect
    .poll(() =>
      page.evaluate(
        (token) =>
          sessionStorage.getItem(`oddlot-pending-${token.slice(0, 16)}`),
        csrf,
      ),
    )
    .toBeNull();
  await expect(page.locator('.od-open-head')).toContainText('$0.00');
  if (await page.getByRole('dialog').count())
    await page.getByRole('button', { name: 'Close dialog' }).click();
  await nav(page, 'Activity');
  await expect(page.getByText('Vault deposit', { exact: true })).toHaveCount(0);
});

test('a refreshed vault invalidates a reviewed stock trade without silently changing its price', async ({
  page,
  context,
}) => {
  await deposit(page, 'USDC', '1000');
  await nav(page, 'Lending');
  await page.getByRole('button', { name: 'Spot', exact: true }).click();
  await page.getByRole('button', { name: 'Review stock trade' }).click();
  await expect(page.getByRole('dialog')).toContainText('$142.62');
  const second = await context.newPage();
  await second.goto('/app');
  await expect(second.locator('.pc-desk')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await nav(second, 'Vault');
  await advance(second, '2025-01-27');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toContainText('Your vault changed');
  await expect(page.getByRole('dialog')).toContainText('$142.62');
  await expect(
    page.getByRole('button', { name: 'Confirm transaction' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Review stock trade' }).click();
  await expect(page.getByRole('dialog')).toContainText('$118.42');
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Vault');
  await expect(
    page.getByRole('row').filter({ hasText: 'NVIDIA' }),
  ).toContainText('1');
  await second.close();
});

test('option confirmation lists every leg and a close is priced before execution', async ({
  page,
}) => {
  await deposit(page, 'USDC', '1000');
  await nav(page, 'Structures');
  await advanced(page);
  await page.getByLabel('Leg 1 ratio', { exact: true }).selectOption('2');
  await page.getByLabel('Leg 2 ratio', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row')).toHaveCount(3);
  await expect(dialog.getByRole('row').nth(1)).toHaveText(
    /Buy.*call.*\$140\.00.*2×.*2/,
  );
  await expect(dialog.getByRole('row').nth(2)).toHaveText(
    /Sell.*call.*\$150\.00.*2×.*2/,
  );
  await page
    .getByRole('button', { name: 'Confirm contract', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await nav(page, 'Positions');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toContainText('Review your close quote');
  await expect(dialog).toContainText('You receive');
  await expect(dialog.getByRole('row').nth(1)).toHaveText(
    /Sell.*call.*\$140\.00.*2×.*2/,
  );
  await page
    .getByRole('button', { name: 'Confirm close', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Close', exact: true }),
  ).toHaveCount(0);
});
test('final historical session offers a fresh replay with usable expiries', async ({
  page,
}) => {
  await advance(page, '2025-04-03');
  await page.getByRole('button', { name: 'Market controls' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Restart historical replay',
  );
  await page.getByRole('button', { name: 'Restart historical replay' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Trade');
  await expect(
    page.getByLabel('Expiration', { exact: true }).locator('option'),
  ).not.toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeEnabled();
});

test('covered-call chart includes deposited stock downside', async ({
  page,
}) => {
  await nav(page, 'Underwrite');
  await expect(page.locator('.od-payoff')).toContainText('Stock and options');
  await page.getByLabel('Reference price move').fill('-30');
  await expect(page.locator('.od-payoff-read b')).toHaveClass('down');

  // The Greeks belong to Advanced, which is what the helper beside this
  // one has always claimed. Net delta still has to account for the
  // deposited stock; it is just no longer printed under the chart for a
  // reader who has not asked for it.
  await expect(page.locator('.od-greeks')).toHaveCount(0);
  await advanced(page);
  await expect(page.locator('.od-greeks')).toContainText('Net delta');
});

test('options chain selects a contract into the same funded quote workflow', async ({
  page,
}) => {
  await deposit(page, 'USDC', '1000');
  await nav(page, 'Trade');
  await advanced(page);
  await page
    .getByRole('button', { name: 'Options chain', exact: true })
    .click();
  await page.getByLabel('Chain expiration').selectOption('2025-02-07');
  await expect(page.locator('.od-chain-table tbody tr')).toHaveCount(11);
  const row = page
    .locator('.od-chain-table tbody tr')
    .filter({ has: page.getByRole('cell', { name: '$145', exact: true }) });
  await expect(row).toContainText('Buy: $145.00');
  await row.getByRole('button', { name: /^Buy/ }).first().click();
  await expect(page.getByLabel('Leg 1 strike', { exact: true })).toHaveValue(
    '145',
  );
  await execute(page);
  await nav(page, 'Positions');
  await expect(
    page.getByRole('cell', { name: /^Long call 145 / }),
  ).toBeVisible();
});
test('budget sizing displays exercise cash separately and feeds the reviewed contract', async ({
  page,
}) => {
  await deposit(page, 'USDC', '1000');
  await nav(page, 'Trade');
  await advanced(page);
  await page
    .getByText('Size by budget or price sensitivity', { exact: true })
    .click();
  await page.getByLabel('Sizing target', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply calculated size' }).click();
  await expect(page.locator('.od-sizing output')).toContainText(
    'standalone cash funding',
  );
  const quantity = Number(
    await page.getByLabel('Contract quantity').inputValue(),
  );
  expect(quantity).toBeGreaterThan(0);
  expect(quantity).toBeLessThan(1);
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Cash reserved after this trade');
  expect(
    Number(
      (await dialog.locator('.od-quote-premium strong').innerText()).replace(
        /[$,]/g,
        '',
      ),
    ),
  ).toBeLessThanOrEqual(1);
});
test('capped curves review every parameter, execute, close with a priced quote and survive reload', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await nav(page, 'Structures');
  await page.getByRole('button', { name: 'Convexity', exact: true }).click();
  await page
    .getByRole('button', { name: /CONVEXITY Capped exponential/ })
    .click();
  await page.getByLabel('Contract quantity').fill('0.333333');
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await expect(page.getByRole('dialog')).toContainText('exponential');
  await expect(page.getByRole('dialog')).toContainText('Maximum payout');
  await page.getByRole('button', { name: 'Confirm contract' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await nav(page, 'Positions');
  await page
    .getByRole('row')
    .filter({ hasText: 'Capped exponential' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(/sell to close/i);
  await page
    .getByRole('button', { name: 'Confirm close', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('hourly contracts settle through the UI at the explicit test clock', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await nav(page, 'Structures');
  await page
    .getByLabel('Expiration', { exact: true })
    .selectOption('2025-01-24T01:00:00Z');
  await execute(page);
  await advance(page, '2025-01-24T01:00:00Z');
  await nav(page, 'Positions');
  await expect(page.getByRole('cell', { name: /^Call spread / })).toHaveCount(
    0,
  );
  await nav(page, 'Activity');
  await expect(page.getByText('Expiry settled', { exact: true })).toBeVisible();
});
test('dividend convexity and progressive controls remain usable at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await deposit(page, 'USDC', '10');
  await nav(page, 'Structures');
  await page.getByRole('button', { name: 'Dividends', exact: true }).click();
  await page
    .getByRole('button', { name: /DIVIDEND EVENT Dividend convexity/ })
    .click();
  await advanced(page);
  await page.getByLabel('Curve side').selectOption('sell');
  await execute(page);
  await nav(page, 'Positions');
  await expect(
    page.getByRole('cell', { name: /^Dividend convexity / }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await advance(page, '2025-03-12');
  await expect(
    page.getByRole('cell', { name: /^Dividend convexity / }),
  ).toHaveCount(0);
});

test('mobile chain keeps strikes, both sides and collateral visible without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, 'Trade');
  await advanced(page);
  await page
    .getByRole('button', { name: 'Options chain', exact: true })
    .click();
  await expect(page.locator('.od-chain-mobile .od-chain-card')).toHaveCount(11);
  await page.getByRole('button', { name: 'Puts', exact: true }).click();
  const card = page
    .locator('.od-chain-mobile .od-chain-card')
    .filter({ has: page.getByText('$145', { exact: true }) });
  await expect(card).toContainText('put strike');
  await expect(card).toContainText('1 share backing');
  await card.getByRole('button', { name: /^Write/ }).click();
  await expect(page.getByLabel('Leg 1 strike', { exact: true })).toHaveValue(
    '145',
  );
  await expect(page.getByLabel('Leg 1 side', { exact: true })).toHaveValue(
    'sell',
  );
  await expect(page.getByLabel('Leg 1 type', { exact: true })).toHaveValue(
    'put',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('a delayed sizing response cannot overwrite a contract edited while sizing', async ({
  page,
}) => {
  await nav(page, 'Trade');
  await advanced(page);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/vault/size', async (route) => {
    const response = await route.fetch();
    started();
    await blocked;
    await route.fulfill({ response });
  });
  await page
    .getByText('Size by budget or price sensitivity', { exact: true })
    .click();
  await page.getByLabel('Sizing target', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply calculated size' }).click();
  await requested;
  await page.getByLabel('Leg 1 strike', { exact: true }).fill('150');
  release();
  await expect(
    page.getByRole('button', { name: 'Apply calculated size' }),
  ).toBeEnabled();
  await expect(page.getByLabel('Contract quantity')).toHaveValue('1');
  await expect(page.getByLabel('Leg 1 strike', { exact: true })).toHaveValue(
    '150',
  );
  await expect(page.locator('.od-sizing output')).toHaveCount(0);
});
