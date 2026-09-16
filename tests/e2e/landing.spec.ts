import { test, expect } from '@playwright/test';

test('the landing page states the problem and routes into the desk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Options, by the share.',
  );
  await expect(page.locator('.lp-hero-figure')).toContainText('$14,262');
  await expect(page.locator('.lp-hero-figure')).toContainText('$0.70');
  await page.getByRole('link', { name: /Launch app/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.oddlot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'What are you trying to do?',
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
