import { expect, type Page } from '@playwright/test';

/**
 * One way to drive the desk from a test.
 *
 * The shell owns navigation now: four items in the app bar, and each
 * view's own sections as tabs beneath it. Every spec was reaching into
 * that structure itself, with three different ideas of where a view
 * lived, so the helpers live here and the specs say what they mean.
 */

/**
 * The walkthrough runs once per browser and covers the desk while it
 * is up. Tests are not that browser's first visit conceptually, so the
 * flag is written before the page script runs rather than dismissed
 * afterwards, which would race every assertion on the first screen.
 */
export async function openDesk(page: Page, path = '/app') {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('parcel.welcome.v1', '1');
    } catch {
      /* the walkthrough will show; the specs that care dismiss it */
    }
  });
  await page.goto(path);
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
}

/** The four destinations in the app bar. */
export async function navTop(page: Page, name: string) {
  const item = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
}

/** A section within the current view. */
export async function section(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Navigate by the name a reader would use, including the names that
 * are now sections rather than destinations.
 */
export async function nav(page: Page, name: string) {
  switch (name) {
    case 'Vault':
    case 'Portfolio':
      await navTop(page, 'Portfolio');
      return section(page, 'Overview');
    case 'Positions':
      await navTop(page, 'Portfolio');
      return section(page, 'Positions');
    case 'Risk':
    case 'Collateral':
      await navTop(page, 'Portfolio');
      return section(page, 'Collateral');
    case 'Activity':
      await navTop(page, 'Portfolio');
      return section(page, 'Activity');
    case 'Trade':
    case 'Underwrite':
    case 'Structures':
      await navTop(page, 'Trade');
      return section(page, name);
    case 'Lending':
      await navTop(page, 'Lending');
      return section(page, 'Borrow & short');
    case 'Lending markets':
      await navTop(page, 'Lending');
      return section(page, 'Markets');
    case 'Lending positions':
      await navTop(page, 'Lending');
      return section(page, 'Positions');
    case 'Pre-IPO':
      return navTop(page, 'Pre-IPO');
    default:
      return navTop(page, name);
  }
}

/** Basic hides the leg editor, the chain and the Greeks. */
export async function advanced(page: Page, on = true) {
  await page
    .getByRole('button', { name: on ? 'Advanced' : 'Basic', exact: true })
    .click();
}

export async function deposit(
  page: Page,
  asset: 'USDC' | 'NVDA',
  amount: string,
) {
  await nav(page, 'Vault');
  await page
    .getByRole('button', { name: `Deposit ${asset}`, exact: true })
    .click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function execute(page: Page) {
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Confirm contract', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Move the replay clock.
 *
 * The control used to be a bare date in the app bar of every page,
 * where nothing said what it was. It now lives on the one panel that is
 * about the replay window, so getting to it means going to Portfolio
 * first — which is what a reader does too. The caller is put back on
 * the destination it was on, because a helper that silently moves the
 * page is a helper that breaks the assertion after it.
 */
export async function advance(page: Page, date: string) {
  const was = await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button')
    .filter({ has: page.locator('[aria-current="page"]') })
    .or(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .locator('[aria-current="page"]'),
    )
    .first()
    .innerText();

  await nav(page, 'Portfolio');
  await page.getByRole('button', { name: 'Market controls' }).click();
  await page.getByLabel('Advance to session').selectOption(date);
  await page
    .getByRole('button', { name: 'Advance & settle due positions' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  if (was.trim() && was.trim() !== 'Portfolio') await navTop(page, was.trim());
}

/** The quote the backend actually priced, not what the form claims. */
export function quoteFor(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
  );
}
