import { test, expect, type Page } from '@playwright/test';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  await page.goto('/app');
  await expect(page.locator('.oddlot')).toHaveAttribute('data-ready', 'true');
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/vault');
    return r.json();
  });
}

/** Steps 1 and 2: choose an intent, then set the size. */
async function sizeTo(page: Page, intent: string, size: string) {
  await page.getByRole('button', { name: new RegExp(intent) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'How much of it?',
  );
  await page
    .getByRole('button', { name: `Size ${size} shares`, exact: true })
    .click();
  await expect(page.locator('.gf-size-read strong')).toHaveText(size);
}

test('the guided flow advances step by step and resizes without placing a trade', async ({
  page,
}) => {
  const before = await snapshot(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'What are you trying to do?',
  );
  await expect(page.locator('.gf-rail li.current')).toContainText('Intent');

  await sizeTo(page, 'Explore premium income', '0.5');
  await expect(page.locator('.gf-rail li.current')).toContainText('Size');

  await page.getByRole('button', { name: 'Review the payoff' }).click();
  await expect(page.locator('.gf-rail li.current')).toContainText('Review');
  await expect(page.locator('.od-chart-caption')).toContainText(
    'Stock + options',
  );
  await page.getByLabel('Reference price move').fill('-30');
  await expect(page.locator('.od-chart-caption b')).toHaveClass('od-negative');
  expect(
    Number(
      (await page.locator('.od-chart-caption b').innerText()).replace(
        /[$,]/g,
        '',
      ),
    ),
  ).toBeLessThan(-10);

  await page.getByRole('button', { name: 'Fund this position' }).click();
  await expect(page.locator('.gf-rail li.current')).toContainText('Fund');
  await expect(page.locator('.gf-review-lines')).toContainText(
    '0.5 share-equivalents',
  );

  // stepping back through a completed step must not lose the position
  await page
    .locator('.gf-rail li.done button')
    .filter({ hasText: 'Size' })
    .click();
  await expect(page.locator('.gf-size-read strong')).toHaveText('0.5');

  const after = await snapshot(page);
  expect(after.book).toEqual(before.book);
  expect(after.revision).toBe(before.revision);
});

for (const [goal, template, kind, side, strikes] of [
  ['Explore the upside', 'Call spread', 'call', 'buy', [145, 155]],
  ['Protect my shares', 'Protective put', 'put', 'buy', [145]],
  ['Explore premium income', 'Covered call', 'call', 'sell', [150]],
] as const)
  test(`${goal} hands the exact scenario to a real backend quote`, async ({
    page,
  }) => {
    await sizeTo(page, goal, '0.5');
    await page.getByRole('button', { name: 'Review the payoff' }).click();
    await page.getByRole('button', { name: 'Fund this position' }).click();
    await page.getByRole('button', { name: 'Open in the builder' }).click();
    await expect(page.getByLabel('Contract quantity')).toHaveValue('0.5');
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Review funded quote' }).click();
    const quote = await (await response).json();
    expect(quote.terms.name).toBe(template);
    expect(quote.terms.quantity).toBe(0.5);
    expect(quote.terms.legs[0].kind).toBe(kind);
    expect(quote.terms.legs[0].side).toBe(side);
    expect(quote.terms.legs.map((l: { strike: number }) => l.strike)).toEqual(
      strikes,
    );
    expect(quote.terms.expiry).toBe('2025-02-07');
    await expect(page.getByRole('dialog')).toContainText(template);
    await expect(
      page.getByRole('button', { name: 'Confirm contract', exact: true }),
    ).toBeDisabled();
    expect((await snapshot(page)).revision).toBe(0);
  });

test('consumer mobile layout, keyboard resizing and direct desk access stay usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /Explore the upside/ }).click();
  await page.getByLabel('Position size').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.gf-size-read strong')).toHaveText('0.26');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Review the payoff' }).click();
  await page.getByRole('button', { name: 'Fund this position' }).click();
  await page.getByRole('button', { name: 'Assets & funding' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A little stock',
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Build', exact: true })
    .click();
  await expect(page.locator('.gf')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
