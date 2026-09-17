import { test, expect } from '@playwright/test';

test('the landing page shows the products and routes into the desk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const [hero, copy, card] = await Promise.all([
    page.locator('.lp-hero').boundingBox(),
    page.locator('.lp-hero-copy').boundingBox(),
    page.locator('.lp-card').boundingBox(),
  ]);
  expect(hero).not.toBeNull();
  expect(copy).not.toBeNull();
  expect(card).not.toBeNull();
  expect(card!.x).toBeGreaterThan(copy!.x + copy!.width);
  expect(card!.x + card!.width).toBeLessThanOrEqual(hero!.x + hero!.width + 1);
  expect(
    Math.abs(card!.y + card!.height / 2 - (copy!.y + copy!.height / 2)),
  ).toBeLessThan(88);

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Options sized to what you own',
  );
  // the product nav lists the products, and only the products
  await expect(
    page.getByRole('navigation', { name: 'Products' }).getByRole('link'),
  ).toHaveCount(5);
  // Methodology is a page-level link, so it sits with the other ones.
  await expect(
    page.locator('.lp-nav-right').getByText('Methodology'),
  ).toBeVisible();
  // the preview card is a priced position, with a term, not a mock-up
  for (const k of ['Size', 'Max loss', 'Break-even', 'Expiry'])
    await expect(page.locator('.lp-stats')).toContainText(k);
  // no stat label may wrap: a two-line label pushes its value off the
  // baseline the other three sit on
  const stats = await page.locator('.lp-stats > div').evaluateAll((ds) =>
    ds.map((d) => {
      const label = d.querySelector('span') as HTMLElement;
      const line = parseFloat(getComputedStyle(label).lineHeight) || 16;
      return {
        lines: Math.round(label.getBoundingClientRect().height / line),
        valueTop: Math.round(
          (d.querySelector('strong') as HTMLElement).getBoundingClientRect()
            .top,
        ),
      };
    }),
  );
  for (const s of stats) expect(s.lines).toBe(1);
  expect(new Set(stats.map((s) => s.valueTop)).size).toBe(1);
  await expect(page.locator('.lp-stats')).toContainText(/\$\d+\.\d{2}/);
  await expect(page.locator('.lp-stats')).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  // the payoff is drawn from the engine, with the strike marked on it
  await expect(page.locator('.lp-card .lp-strike')).toHaveCount(1);
  await expect(page.locator('.lp-card-title-row p')).toContainText('expires');
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
  await page.getByRole('button', { name: '0.25×', exact: true }).click();
  await expect(page.locator('.lp-stats')).toContainText('0.25 shares');
  await expect(page.locator('.lp-stats')).toContainText('$1.01');
  // one product at a time: five tabs, exactly one open panel
  const tabs = ['Options', 'Underwriting', 'Structures', 'Pre-IPO', 'Lending'];
  await expect(page.getByRole('tab')).toHaveCount(tabs.length);
  await expect(page.locator('.lp-panel')).toHaveCount(1);
  await expect(page.locator('#how')).toHaveCount(1);

  // each shows a worked figure and a preview of what it does
  for (const name of tabs) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const panel = page.locator('.lp-panel');
    await expect(panel.locator('.lp-example > div')).not.toHaveCount(0);
    await expect(
      panel.locator('.lp-preview-chart, .lp-outcomes, .lp-split'),
    ).toHaveCount(1);
  }
  await page.getByRole('tab', { name: 'Pre-IPO', exact: true }).click();
  await expect(page.locator('.lp-panel')).toContainText('231.50 USDC');
  // no in-page link points at an anchor that does not exist
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute('href') as string)
        .filter((h) => h !== '#' && !document.querySelector(h)),
    ),
  ).toEqual([]);
  // a product link in the nav opens that product
  await page.goto('/#structures');
  await expect(
    page.getByRole('tab', { name: 'Structures', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('link', { name: /Enter sandbox/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.parcel')).toHaveAttribute('data-ready', 'true');
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
  const [card, sizeControl] = await Promise.all([
    page.locator('.lp-card').boundingBox(),
    page.locator('.lp-size-control').boundingBox(),
  ]);
  expect(card).not.toBeNull();
  expect(sizeControl).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(390);
  expect(sizeControl!.x + sizeControl!.width).toBeLessThanOrEqual(
    card!.x + card!.width,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
