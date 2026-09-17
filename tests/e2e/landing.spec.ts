import { test, expect, type Page } from '@playwright/test';

type LandingLayout = {
  headingLines: number;
  editorialOffset: number;
  foundationAfterScroll: number;
  rails: number[];
  scrollAfterContent: number;
  horizontalOverflow: number;
};

async function loadLandingWithTheme(page: Page, theme: 'light' | 'dark') {
  await page.goto('/');
  await page.evaluate((activeTheme) => {
    localStorage.setItem('theme', activeTheme);
    document.documentElement.dataset.theme = activeTheme;
  }, theme);
  await page.reload();
  await expect(page.locator('.lp')).toBeVisible();
}

async function measureLandingLayout(page: Page): Promise<LandingLayout> {
  return page.evaluate(() => {
    const getBox = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
      };
    };

    const navMark = getBox('.lp-nav .lp-mark');
    const heroCopy = getBox('.lp-hero-copy');
    const heroCard = getBox('.lp-card');
    const scrollCue = getBox('.lp-scroll');
    const foundationsCopy = getBox('.lp-foundations p');
    const productsHead = getBox('.lp-section-head');
    const workflowCopy = getBox('.lp-how .lp-section-copy');
    const closingHeading = getBox('.lp-close h2');
    const footerLead = getBox('.lp-foot > span:first-child');
    const productsHeading = getBox('.lp-section-head h2');
    const productsAnnotation = getBox('.lp-section-head p');
    const foundations = getBox('.lp-foundations');
    const headingElement = document.querySelector('.lp-section-head h2');
    if (!headingElement) throw new Error('Missing product heading');

    const lineHeight = parseFloat(getComputedStyle(headingElement).lineHeight);
    return {
      headingLines: Math.round(productsHeading.height / lineHeight),
      editorialOffset: productsAnnotation.y - productsHeading.y,
      foundationAfterScroll: foundations.y - scrollCue.bottom,
      rails: [
        navMark.x,
        heroCopy.x,
        foundationsCopy.x,
        productsHead.x,
        workflowCopy.x,
        closingHeading.x,
        footerLead.x,
      ],
      scrollAfterContent:
        scrollCue.y - Math.max(heroCopy.bottom, heroCard.bottom),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

test('the landing uses one desktop rail and a disciplined vertical rhythm', async ({
  page,
}) => {
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];
  const themes = ['light', 'dark'] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const theme of themes) {
      await loadLandingWithTheme(page, theme);
      const layout = await measureLandingLayout(page);

      expect(
        Math.max(...layout.rails) - Math.min(...layout.rails),
      ).toBeLessThanOrEqual(1);
      expect(layout.scrollAfterContent).toBeGreaterThanOrEqual(0);
      expect(layout.scrollAfterContent).toBeLessThanOrEqual(64);
      expect(layout.foundationAfterScroll).toBeGreaterThanOrEqual(0);
      expect(layout.foundationAfterScroll).toBeLessThanOrEqual(64);
      expect(Math.abs(layout.editorialOffset)).toBeLessThanOrEqual(1);
      expect(layout.headingLines).toBeLessThanOrEqual(2);
      expect(layout.horizontalOverflow).toBe(0);
    }
  }
});

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

test('the landing stays contained at responsive widths in both themes', async ({
  page,
}) => {
  const viewports = [
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ];
  const themes = ['light', 'dark'] as const;
  const selectors = [
    '.lp-nav',
    '.lp-hero-copy',
    '.lp-card',
    '.lp-size-control',
    '.lp-foundations-inner',
    '.lp-section-head',
    '.lp-tabs',
    '.lp-panel',
    '.lp-how-inner',
    '.lp-close-inner',
    '.lp-foot',
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const theme of themes) {
      await loadLandingWithTheme(page, theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const layout = await page.evaluate((targetSelectors) => {
        const bounds = targetSelectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          const rectangle = element.getBoundingClientRect();
          return { left: rectangle.left, right: rectangle.right };
        });
        const card = document
          .querySelector('.lp-card')
          ?.getBoundingClientRect();
        const sizeControl = document
          .querySelector('.lp-size-control')
          ?.getBoundingClientRect();
        if (!card || !sizeControl) throw new Error('Missing position controls');
        return {
          bounds,
          cardRight: card.right,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
          sizeControlRight: sizeControl.right,
        };
      }, selectors);

      for (const bounds of layout.bounds) {
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(viewport.width);
      }
      expect(layout.sizeControlRight).toBeLessThanOrEqual(layout.cardRight);
      expect(layout.horizontalOverflow).toBe(0);
    }
  }
});
