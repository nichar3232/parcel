import { expect, test } from '@playwright/test';
import { nav, navTop, openDesk } from './desk-helpers';

test.beforeEach(async ({ page }) => {
  await openDesk(page);
});

test('the unified watchlist searches, removes and restores public and PreStocks listings', async ({
  page,
}) => {
  await nav(page, 'Watchlist');
  await expect(
    page.getByRole('heading', { name: 'Watchlist', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Public equities', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('PreStocks', { exact: true }).last(),
  ).toBeVisible();
  const search = page.getByLabel('Search public equities and PreStocks');
  await expect(search).toBeVisible();
  // The public universe renders immediately; wait for the independently
  // fetched publisher catalog before exercising a unified default list.
  await expect(
    page.getByRole('button', { name: 'Remove OpenAI from watchlist' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Remove Tesla from watchlist' })
    .click();
  await search.fill('tesla');
  await expect(page.getByText('Catalog matches')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Tesla from watchlist' }),
  ).toBeVisible();

  await search.fill('');
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
