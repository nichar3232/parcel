import { expect, test } from '@playwright/test';
import { navTop, openDesk } from './desk-helpers';

test.beforeEach(async ({ page }) => {
  await openDesk(page);
});

/**
 * The Pre-IPO ticket writes through the vault.
 *
 * The journey a seller takes: pick a company on the market, be told
 * the tokens are not in the vault yet, deposit them, review the
 * server's funded quote, confirm, and find the contract in the
 * portfolio with the rest of the book.
 */
test('a pre-IPO covered call is quoted, written and shown in the portfolio', async ({
  page,
}) => {
  await navTop(page, 'Pre-IPO');
  const row = page.locator('tr.od-market-row').first();
  await expect(row).toContainText('Escrowable');
  await row.click();

  // The ticket is up, and it knows the vault is empty of this token.
  await expect(page.getByLabel('Tokens to escrow')).toHaveValue('0.25');
  await expect(
    page.getByRole('button', { name: 'Review covered call' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Deposit T-/ })).toBeVisible();

  // Fund it from the ticket's own cue, which opens the same deposit
  // dialog the portfolio uses, and stay on the ticket.
  await page.getByRole('button', { name: /^Deposit T-/ }).click();
  await page.getByLabel('Amount', { exact: true }).fill('0.25');
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const review = page.getByRole('button', { name: 'Review covered call' });
  await expect(review).toBeEnabled();
  await review.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You receive');
  await expect(dialog).toContainText('T-OpenAI');
  await dialog.getByRole('button', { name: 'Confirm contract' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.od-written')).toContainText('Written.');

  await navTop(page, 'Portfolio');
  await expect(page.getByText('OpenAI covered call').first()).toBeVisible();
});
