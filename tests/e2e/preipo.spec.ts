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

test('Pre-IPO lists each company with a market and opens options on it', async ({
  page,
}) => {
  await navTop(page, 'Pre-IPO');
  // No escrow gate and no empty holders column: price, bid, ask, move.
  await expect(page.getByText('Blocked')).toHaveCount(0);
  const row = page.locator('.od-pm-row:not(.od-pm-cols)').first();
  await expect(row).toBeVisible();
  const company = (await row.locator('.od-pm-company b').textContent())!;
  await row.click();
  await expect(
    page.getByRole('heading', { level: 1, name: company }),
  ).toBeVisible();
  // The same chain and ticket as NVDA, written on the company's token.
  await expect(page.getByRole('group', { name: 'Side' })).toBeVisible();
  await expect(page.locator('.od-ladder')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review funded quote' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Pre-IPO market' }).click();
  await expect(
    page.locator('.od-pm-row:not(.od-pm-cols)').first(),
  ).toBeVisible();
});
