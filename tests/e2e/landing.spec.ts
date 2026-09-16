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
  // the product nav lists the products, and only the products
  await expect(
    page.getByRole('navigation', { name: 'Products' }).getByRole('link'),
  ).toHaveCount(5);
  // About is a page-level link, so it sits with the other ones
  await expect(page.locator('.lp-nav-right').getByText('About')).toBeVisible();
  // the preview card is a priced position, with a term, not a mock-up
  for (const k of ['Size', 'Cost, and max loss', 'Break-even', 'Expiry'])
    await expect(page.locator('.lp-stats')).toContainText(k);
  await expect(page.locator('.lp-stats')).toContainText(/\$\d+\.\d{2}/);
  await expect(page.locator('.lp-stats')).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  // the payoff is drawn from the engine, with the strike marked on it
  await expect(page.locator('.lp-card .lp-strike')).toHaveCount(1);
  await expect(page.locator('.lp-card h2 small')).toContainText('expires');
  // a long call's payoff rises to the right and is not capped
  const ys = await page
    .locator('.lp-card .lp-line')
    .evaluate((el) =>
      [
        ...(el as SVGPathElement)
          .getAttribute('d')!
          .matchAll(/[ML][\d.]+,([\d.]+)/g),
      ].map((m) => Number(m[1])),
    );
  expect(ys.at(-1)!).toBeLessThan(ys[0]);
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
