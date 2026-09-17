import { test, expect } from '@playwright/test';

test('the landing page shows the products and routes into the desk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Every options structure',
  );
  // the product nav lists the products, and only the products
  await expect(
    page.getByRole('navigation', { name: 'Products' }).getByRole('link'),
  ).toHaveCount(5);

  // The viewer quotes a priced position, with a term, not a mock-up.
  const viewer = page.locator('.lp-viewer');
  for (const k of ['Size', 'Max loss', 'Max gain', 'Break-even'])
    await expect(viewer.locator('.lp-viewer-stats')).toContainText(k);
  await expect(viewer.locator('.lp-viewer-contract')).toContainText('$');

  // No stat label may wrap: a two-line label pushes its value off the
  // baseline the other three sit on.
  const stats = await viewer
    .locator('.lp-viewer-stats > div')
    .evaluateAll((ds) =>
      ds.map((d) => {
        const label = d.querySelector('dt') as HTMLElement;
        const line = parseFloat(getComputedStyle(label).lineHeight) || 16;
        return {
          lines: Math.round(label.getBoundingClientRect().height / line),
          valueTop: Math.round(
            (d.querySelector('dd') as HTMLElement).getBoundingClientRect().top,
          ),
        };
      }),
    );
  for (const s of stats) expect(s.lines).toBe(1);
  expect(new Set(stats.map((s) => s.valueTop)).size).toBe(1);

  // The gridlines, the strikes and the price axis are all drawn from
  // one frame, so every label sits inside the plot it describes.
  const frame = await viewer.locator('svg').evaluate((svg) => {
    const box = (svg as SVGSVGElement).viewBox.baseVal;
    const xs = [...svg.querySelectorAll('.lp-grid-band line')].map((l) => ({
      x1: Number(l.getAttribute('x1')),
      x2: Number(l.getAttribute('x2')),
    }));
    const ticks = [...svg.querySelectorAll('.lp-ticks text')].map((t) =>
      Number(t.getAttribute('x')),
    );
    return { width: box.width, xs, ticks };
  });
  expect(frame.xs.length).toBeGreaterThan(0);
  for (const tick of frame.ticks) {
    expect(tick).toBeGreaterThanOrEqual(frame.xs[0].x1);
    expect(tick).toBeLessThanOrEqual(frame.xs[0].x2);
  }

  // The first structure is a long call: it rises to the right and is
  // not capped, which is why it opens the page.
  const ys = await viewer
    .locator('.lp-curve')
    .evaluate((el) =>
      [
        ...(el as SVGPathElement)
          .getAttribute('d')!
          .matchAll(/[ML][\d.]+,([\d.]+)/g),
      ].map((m) => Number(m[1])),
    );
  expect(ys.at(-1)!).toBeLessThan(ys[0]);
  await expect(viewer.locator('.lp-viewer-stats')).toContainText('∞');

  // Picking another structure changes the shape and the figures.
  const first = await viewer.locator('h2').textContent();
  await viewer.locator('.lp-viewer-pips button').nth(3).click();
  await expect(viewer.locator('h2')).not.toHaveText(first!);

  // The status rail states what the desk is actually running on.
  await expect(page.locator('.lp-rail > div')).toHaveCount(4);
  await expect(page.locator('.lp-rail')).toContainText(/\$\d+\.\d{2}/);

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

  // The interpunct is the product's most reliable tell that a line was
  // written to look finished rather than to be read.
  expect(await page.evaluate(() => document.body.innerText)).not.toContain('·');

  // a product link in the nav opens that product
  await page.goto('/#structures');
  await expect(
    page.getByRole('tab', { name: 'Structures', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  await page
    .locator('.lp-hero-actions')
    .getByRole('link', { name: /Open the desk/ })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Portfolio',
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
