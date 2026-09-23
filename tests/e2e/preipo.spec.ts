import { expect, test } from '@playwright/test';
import { nav, navTop, openDesk } from './desk-helpers';

test.beforeEach(async ({ page }) => {
  await openDesk(page);
});

test('the unified watchlist searches, removes and restores PreStocks listings', async ({
  page,
}) => {
  await nav(page, 'Watchlist');
  await expect(
    page.getByRole('heading', { name: 'Watchlist', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Solana tokenized equities', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('PreStocks', { exact: true }).last(),
  ).toBeVisible();
  const search = page.getByLabel('Search tokenized equities and PreStocks');
  await expect(search).toBeVisible();
  // The publisher catalog is independently fetched before exercising the
  // saved PreStocks portion of the unified list.
  await expect(
    page.getByRole('button', { name: 'Remove OpenAI from watchlist' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Remove OpenAI from watchlist' })
    .click();
  await search.fill('openai');
  await expect(page.getByText('Catalog matches')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove OpenAI from watchlist' }),
  ).toBeVisible();
});

test('Pre-IPO shows publisher listings but refuses unsupported escrow', async ({
  page,
}) => {
  await navTop(page, 'Pre-IPO');
  const row = page.locator('tr.od-market-row').first();
  await expect(row).toContainText('Blocked');
  await row.click();
  await expect(page.getByText('Not escrowable in this version.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review covered call' }),
  ).toHaveCount(0);
});
