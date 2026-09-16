import { test, expect } from '@playwright/test';

test('the landing page shows the products and routes into the desk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Options sized to what you own',
  );
  // product offerings are reachable from the top nav
  await expect(
    page.getByRole('navigation', { name: 'Products' }).getByRole('link'),
  ).toHaveCount(6);
  // the preview card carries the numbers, not prose
  for (const v of ['$0.70', '¼ share', 'USDC', 'Solana'])
    await expect(page.locator('.lp-stats')).toContainText(v);
  // every product has a section below the fold, with a worked figure
  for (const id of [
    'options',
    'underwriting',
    'structures',
    'pre-ipo',
    'lending',
    'how',
  ])
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  await expect(page.locator('#pre-ipo')).toContainText('231.50 USDC');
  // no in-page link points at an anchor that does not exist
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute('href') as string)
        .filter((h) => h !== '#' && !document.querySelector(h)),
    ),
  ).toEqual([]);
  await page.getByRole('link', { name: /Launch app/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.oddlot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A little stock',
  );
  expect(errors).toEqual([]);
});

test('the landing page fits a phone without horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
