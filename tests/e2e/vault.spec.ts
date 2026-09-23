import { test, expect, type Page } from '@playwright/test';
import {
  advance,
  advanced,
  deposit,
  execute,
  nav,
  openDesk,
  openUsdcDeposit,
  restartReplay,
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

test('vault keeps its live value line and positions in one responsive flow', async ({
  page,
}) => {
  const chart = page.locator('.od-vline');
  const positions = page.getByRole('region', { name: 'Positions' });

  await expect(chart).toBeVisible();
  await expect(positions).toBeVisible();
  await expect(page.locator('.od-open-side')).toHaveCount(0);

  const [chartBox, positionsBox] = await Promise.all([
    chart.boundingBox(),
    positions.boundingBox(),
  ]);
  expect(chartBox).not.toBeNull();
  expect(positionsBox).not.toBeNull();
  expect(positionsBox!.y).toBeGreaterThan(chartBox!.y + chartBox!.height);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chart).toBeVisible();
  await expect(positions).toBeVisible();
  // On a phone a row keeps the asset and its value, and never scrolls sideways.
  const row = page.locator('.od-ptable-row:not(.od-ptable-cols)').first();
  await expect(row.locator('.od-ptable-type')).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
    page.locator('.od-ptable-row').filter({ hasText: '$100 call' }),
  ).toContainText('0.333333');
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
  await page
    .getByRole('group', { name: 'Leg 1 side' })
    .getByRole('button', { name: 'Sell' })
    .click();
  await page
    .getByRole('group', { name: 'Leg 2 side' })
    .getByRole('button', { name: 'Buy' })
    .click();
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
  await page.getByRole('button', { name: 'Review stock loan' }).click();
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Lending positions');
  await expect(
    page.getByRole('button', { name: 'Recall', exact: true }),
  ).toBeVisible();
  await advance(page, '2025-01-27');
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Interest you receive');
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Recall', exact: true }),
  ).toHaveCount(0);
  await nav(page, 'Lending short');
  await page.getByLabel('Protective call strike').fill('120');
  await page.getByRole('button', { name: 'Review protected short' }).click();
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advance(page, '2025-01-28');
  await nav(page, 'Lending positions');
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'You pay to cover and repay',
  );
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cover', exact: true }),
  ).toHaveCount(0);
  await nav(page, 'Activity');
  await expect(
    page.getByText('Protected short closed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Lent shares returned', { exact: true }),
  ).toBeVisible();
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
        path: `test-results/audit/parcel/${name.toLowerCase()}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await nav(page, 'Trade');
  await page.getByRole('button', { name: 'Payoff', exact: true }).click();
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
  await openUsdcDeposit(second);
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
  await page.getByRole('button', { name: 'Payoff', exact: true }).click();
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
  await page.getByRole('button', { name: 'Payoff', exact: true }).click();
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
    page.locator('.od-ptable-row').filter({ hasText: /NVDA \$[\d.]+ call/ }),
  ).toContainText('0.25');
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
  await openUsdcDeposit(page);
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
  await openUsdcDeposit(page);
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
  await openUsdcDeposit(page);
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
          sessionStorage.getItem(`parcel-pending-${token.slice(0, 16)}`),
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
  await nav(page, 'Lending spot');
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
    page.locator('.od-ptable-row').filter({ hasText: 'NVIDIA' }),
  ).toContainText('1 NVDA');
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
  await restartReplay(page);
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
  await page.getByLabel('Chain expiration').click();
  await page.getByRole('button', { name: /02\/07\/2025/ }).click();
  await expect(page.locator('.od-ladder tbody tr')).not.toHaveCount(0);
  const row = page
    .locator('.od-ladder tbody tr')
    .filter({ hasText: /^\$145\b/ });
  await row.getByRole('button').click();
  await expect(page.getByText('Position simulation')).toBeVisible();
  await advanced(page);
  await expect(page.getByLabel('Leg 1 strike', { exact: true })).toHaveValue(
    '145',
  );
  await execute(page);
  await nav(page, 'Positions');
  await expect(
    page.locator('.od-ptable-row').filter({ hasText: 'NVDA $145 call' }),
  ).toBeVisible();
});
test('sizing in dollars converts at the premium and feeds the reviewed contract', async ({
  page,
}) => {
  await deposit(page, 'USDC', '1000');
  await nav(page, 'Trade');
  await page.getByRole('button', { name: 'Payoff', exact: true }).click();
  await page
    .getByRole('group', { name: 'Size unit' })
    .getByRole('button', { name: 'USD' })
    .click();
  await page.getByLabel('Premium budget in USD').fill('1');
  await page
    .getByRole('group', { name: 'Size unit' })
    .getByRole('button', { name: 'Shares' })
    .click();
  const quantity = Number(
    await page.getByLabel('Contract quantity').inputValue(),
  );
  expect(quantity).toBeGreaterThan(0);
  expect(quantity).toBeLessThan(1);
  // Exercise cash for a physical call is its own line, not part of the budget.
  await expect(page.locator('.od-ticket')).toContainText(
    'Reserved until expiry',
  );
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
  ).toBeLessThanOrEqual(1.000001);
});
test('capped curves review every parameter, execute, close with a priced quote and survive reload', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await nav(page, 'Convexity structures');
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
    .locator('.od-ptable-row')
    .filter({ hasText: 'Capped exponential' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(/sell to close/i);
  await page
    .getByRole('button', { name: 'Confirm close', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('short-dated contracts settle through the session harness', async ({
  page,
}) => {
  await deposit(page, 'USDC', '100');
  await nav(page, 'Structures');
  await page
    .getByLabel('Expiration', { exact: true })
    .selectOption('2025-01-27');
  await execute(page);
  await advance(page, '2025-01-27');
  await nav(page, 'Positions');
  await expect(page.getByRole('cell', { name: /^Call spread / })).toHaveCount(
    0,
  );
  await nav(page, 'Activity');
  await expect(page.getByText('Expiry settled', { exact: true })).toBeVisible();
});
test('convexity and progressive controls remain usable at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await deposit(page, 'USDC', '100');
  await nav(page, 'Convexity structures');
  await page
    .getByRole('button', { name: /CONVEXITY Capped exponential/ })
    .click();
  await advanced(page);
  await page.getByLabel('Contract quantity').fill('0.333333');
  await execute(page);
  await nav(page, 'Positions');
  await expect(
    page.locator('.od-ptable-row').filter({ hasText: 'Capped exponential' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('mobile chain keeps strikes, both sides and collateral visible without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, 'Trade');
  await expect(page.locator('.od-ladder')).toBeVisible();
  await page.getByRole('button', { name: 'Put', exact: true }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  const card = page
    .locator('.od-ladder tbody tr')
    .filter({ hasText: /^\$145\b/ });
  // Both sides of the market survive the phone layout: the bid a
  // writer receives is the button, the ask beside it is still quoted.
  await expect(card.getByRole('button')).toBeVisible();
  await expect(card.locator('.od-ladder-other')).toBeVisible();
  // The ladder has to fit the phone. Its last column is the price a
  // reader taps to take that strike into the ticket, so a ladder wider
  // than its scroller does not merely look wrong: the action is
  // unreachable without scrolling the table sideways.
  expect(
    await page.evaluate(() => {
      const scroller = document.querySelector('.od-ladder-scroll');
      return scroller ? scroller.scrollWidth <= scroller.clientWidth : false;
    }),
  ).toBe(true);
  await card.getByRole('button').click();
  await page.getByRole('button', { name: 'Payoff', exact: true }).click();
  await advanced(page);
  await expect(page.getByLabel('Leg 1 strike', { exact: true })).toHaveValue(
    '145',
  );
  await expect(
    page
      .getByRole('group', { name: 'Leg 1 side' })
      .getByRole('button', { name: 'Sell' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Leg 1 type' })
      .getByRole('button', { name: 'Put' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('a cash loan against pledged stock draws and repays through the real API', async ({
  page,
}) => {
  await deposit(page, 'NVDA', '2');
  await nav(page, 'Lending');
  await page
    .getByRole('group', { name: 'Lending action' })
    .getByRole('button', { name: 'Borrow', exact: true })
    .click();
  await expect(page.getByText('Borrow against stock')).toBeVisible();
  await page.getByLabel('Borrow amount').fill('40');
  await page.getByRole('button', { name: 'Review cash loan' }).click();
  await expect(page.getByRole('dialog')).toContainText('You receive now');
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Lending positions');
  await expect(page.getByRole('button', { name: 'Repay' })).toBeVisible();
  await page.getByRole('button', { name: 'Repay' }).click();
  await expect(page.getByRole('dialog')).toContainText('You pay to repay');
  await page.getByRole('button', { name: 'Confirm transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Repay' })).toHaveCount(0);
});
