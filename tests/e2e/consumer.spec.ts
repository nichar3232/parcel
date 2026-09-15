import { test, expect, type Page } from '@playwright/test';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  await page.goto('/');
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

test('consumer exploration shows stock downside and resizes without placing a trade', async ({
  page,
}) => {
  const before = await snapshot(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'make sense',
  );
  await page.getByRole('button', { name: /Explore premium income/ }).click();
  await page
    .getByRole('button', { name: 'Explore 0.5 shares', exact: true })
    .click();
  await expect(page.locator('.oc-size-value strong')).toHaveText('0.5');
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
    await page.getByRole('button', { name: new RegExp(goal) }).click();
    await page
      .getByRole('button', { name: 'Explore 0.5 shares', exact: true })
      .click();
    await page.getByRole('button', { name: 'Open this setup' }).click();
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
  await page.getByLabel('Explore position size').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.oc-size-value strong')).toHaveText('0.26');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'View assets & funding' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A little stock',
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Explore', exact: true })
    .click();
  await expect(page.locator('.oc-home')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
