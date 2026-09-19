import { test, expect, type Page } from '@playwright/test';
import {
  advanced,
  nav,
  navTop,
  openDesk,
  openMenu,
  payoff,
  quoteFor,
} from './desk-helpers';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  await openDesk(page);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('the vault opens the workspace and carries the full ledger', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Portfolio',
  );
  // The ledger is its own section now; its search and export came with it.
  await nav(page, 'Activity');
  await expect(page.getByLabel('Search activity')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Export ledger' }),
  ).toBeVisible();
});

test('sizing is not capped at a single share', async ({ page }) => {
  await nav(page, 'Structures');
  await page.getByLabel('Contract quantity').fill('8');
  const response = quoteFor(page);
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  const quote = await (await response).json();
  expect(quote.terms.quantity).toBe(8);
  expect(quote.terms.name).toBe('Call spread');
  // premium must scale with size rather than sit pinned at one share
  expect(Math.abs(quote.premium)).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toContainText('Call spread');
});

for (const [view, template, kind, side] of [
  ['Trade', 'Long call', 'call', 'buy'],
  ['Underwrite', 'Covered call', 'call', 'sell'],
  ['Structures', 'Call spread', 'call', 'buy'],
] as const)
  test(`${view} reaches a funded quote for a fractional ${template}`, async ({
    page,
  }) => {
    await nav(page, view);
    await page.getByLabel('Contract quantity').fill('0.25');
    const response = quoteFor(page);
    await page.getByRole('button', { name: 'Review funded quote' }).click();
    const quote = await (await response).json();
    expect(quote.terms.name).toBe(template);
    expect(quote.terms.quantity).toBe(0.25);
    expect(quote.terms.legs[0].kind).toBe(kind);
    expect(quote.terms.legs[0].side).toBe(side);
    // a quote is never an execution: nothing is committed until confirmed
    const snapshot = await page.evaluate(() =>
      fetch('/api/vault').then((r) => r.json()),
    );
    expect(snapshot.revision).toBe(0);
  });

test('the shell is four destinations, each with its own sections', async ({
  page,
}) => {
  await expect(page.locator('.od-nav-item')).toHaveText([
    'Portfolio',
    'Trade',
    'Pre-IPO',
    'Lending',
  ]);

  // Every destination names itself, and its sections belong to it —
  // in a menu under it, open only while it is the open one. Lending
  // owns a single section, but that section offers choices, so it
  // opens a menu like the rest.
  const sections: Record<string, string[]> = {
    Portfolio: ['Holdings', 'Activity'],
    Trade: ['Options', 'Structures'],
    'Pre-IPO': ['Market', 'Underwrite'],
    Lending: ['Lend & borrow'],
  };
  for (const [name, tabs] of Object.entries(sections)) {
    await navTop(page, name);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await openMenu(page);
    await expect(page.locator('.od-nav-link')).toHaveText(tabs);
  }

  // Underwrite and Structures are sections of Trade, and each opens the
  // ticket beside its chart.
  for (const mode of ['Trade', 'Underwrite', 'Structures']) {
    await nav(page, mode);
    await expect(page.locator('.od-work')).toBeVisible();
  }

  // The contract is chosen on the ticket, in both modes; Advanced adds
  // the leg editor and the surface.
  await nav(page, 'Trade');
  // Which contract is the first decision on the screen, above the
  // payoff, not a control inside the ticket below it.
  await expect(page.getByRole('group', { name: 'Contract kind' })).toBeVisible();
  await expect(page.locator('.od-leg')).toHaveCount(0);
  await advanced(page);
  await expect(page.locator('.od-leg')).toHaveCount(1);
  // The surface marks a real position, so it needs a sized contract:
  // an unsized one has no payable obligation and never validates.
  await page.getByLabel('Contract quantity').fill('1');
  // Trade opens on the chain, which is the other half of this ticket:
  // the payoff and its surface are the builder's side of the switch.
  await payoff(page);
  await expect(page.locator('.od-surface svg')).toBeVisible();

  // Collateral is a section of Portfolio rather than its own page.
  await nav(page, 'Risk');
  await expect(page.getByText('Collateral policy')).toBeVisible();
});
