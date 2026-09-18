import { expect, type Page } from '@playwright/test';

/**
 * One way to drive the desk from a test.
 *
 * The shell owns navigation now: four items down the left rail, and
 * each view's own sections nested under it while it is open. Every
 * spec was reaching into that structure itself, with three different
 * ideas of where a view lived, so the helpers live here and the specs
 * say what they mean.
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

/** The four destinations in the left rail. */
export async function navTop(page: Page, name: string) {
  const item = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
}

/**
 * A section within the current view.
 *
 * Sections are nested under their view in the rail, and only while
 * that view is open. A view with one section has no list to open, so
 * arriving at the view is arriving at the section and there is
 * nothing here to click.
 */
export async function section(page: Page, name: string) {
  const item = page.locator('.od-side-sub-item', { hasText: name });
  if ((await item.count()) === 0) return;
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'true');
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
      return section(page, 'Holdings');
    // Positions and Collateral are no longer tabs of their own: the
    // open positions are on Holdings, and the collateral policy is a
    // setting reached from the line that states it.
    case 'Positions':
      await navTop(page, 'Portfolio');
      return section(page, 'Holdings');
    case 'Risk':
    case 'Collateral':
      await navTop(page, 'Portfolio');
      await section(page, 'Holdings');
      return page.getByRole('button', { name: 'Change', exact: true }).click();
    case 'Activity':
      await navTop(page, 'Portfolio');
      return section(page, 'Activity');
    // Buying and writing are one section now; the side is a choice on
    // the ticket.
    case 'Trade':
      await navTop(page, 'Trade');
      await section(page, 'Options');
      return page
        .getByRole('button', { name: 'Long call', exact: true })
        .click();
    case 'Underwrite':
      await navTop(page, 'Trade');
      await section(page, 'Options');
      return page
        .getByRole('button', { name: 'Covered call', exact: true })
        .click();
    case 'Structures':
      await navTop(page, 'Trade');
      return section(page, 'Structures');
    case 'Lending':
      await navTop(page, 'Lending');
      return section(page, 'Lend & borrow');
    case 'Lending markets':
      await navTop(page, 'Lending');
      return section(page, 'Rates');
    case 'Lending positions':
      await navTop(page, 'Portfolio');
      return section(page, 'Holdings');
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

export async function advance(page: Page, date: string) {
  await page.getByRole('button', { name: 'Market controls' }).click();
  await page.getByLabel('Advance to session').selectOption(date);
  await page
    .getByRole('button', { name: 'Advance & settle due positions' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The quote the backend actually priced, not what the form claims. */
export function quoteFor(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
  );
}
