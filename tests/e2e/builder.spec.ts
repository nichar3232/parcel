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

const nav = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true })
    .click();

/** The quote the backend actually priced, not what the form claims. */
function quoteFor(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
  );
}

test('the vault opens the workspace and carries the full ledger', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A little stock',
  );
  // the ledger moved here from its own tab; its search and export came with it
  await expect(page.getByLabel('Search activity')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export ledger' })).toBeVisible();
});

test('sizing is not capped at a single share', async ({ page }) => {
  await nav(page, 'Structures');
  await page.getByLabel('Contract quantity').fill('8');
  const response = quoteFor(page);
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  const quote = await (await response).json();
  expect(quote.terms.quantity).toBe(8);
  expect(quote.terms.name).toBe('Call spread');
  // premium must scale with size rather than sit pinned at one share
  expect(Math.abs(quote.premium)).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toContainText('Call spread');
});

for (const [view, template, kind, side] of [
  ['Trade', 'Long call', 'call', 'buy'],
  ['Underwrite', 'Covered call', 'call', 'sell'],
  ['Structures', 'Call spread', 'call', 'buy'],
] as const)
  test(`${view} reaches a funded quote for a fractional ${template}`, async ({
    page,
  }) => {
    await nav(page, view);
    await page.getByLabel('Contract quantity').fill('0.25');
    const response = quoteFor(page);
    await page.getByRole('button', { name: 'Review funded quote' }).click();
    const quote = await (await response).json();
    expect(quote.terms.name).toBe(template);
    expect(quote.terms.quantity).toBe(0.25);
    expect(quote.terms.legs[0].kind).toBe(kind);
    expect(quote.terms.legs[0].side).toBe(side);
    // a quote is never an execution: nothing is committed until confirmed
    const snapshot = await page.evaluate(() =>
      fetch('/api/vault').then((r) => r.json()),
    );
    expect(snapshot.revision).toBe(0);
  });

test('the removed tabs are gone and the rest still navigate', async ({
  page,
}) => {
  const items = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button');
  await expect(items).toHaveText([
    'Vault',
    'Trade',
    'Underwrite',
    'Structures',
    'Lending',
    'Risk',
  ]);
  for (const name of ['Trade', 'Underwrite', 'Structures', 'Lending', 'Risk']) {
    await nav(page, name);
    await expect(page.locator('h1')).toBeVisible();
  }
});
