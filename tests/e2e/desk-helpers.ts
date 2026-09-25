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
  if (name === 'Rates') return;
  await page.locator('.od-nav-link', { hasText: name }).click();
}

/** Pick a named contract or lending workflow from its owning product menu. */
async function pick(page: Page, product: string, name: string) {
  await navTop(page, product);
  await page.locator('.od-nav-pick', { hasText: name }).click();
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
    // open positions and health sit on Holdings.
    case 'Positions':
      await navTop(page, 'Portfolio');
      return section(page, 'Holdings');
    case 'Risk':
    case 'Collateral':
      await navTop(page, 'Portfolio');
      return section(page, 'Holdings');
    case 'Activity':
      await navTop(page, 'Portfolio');
      return section(page, 'Activity');
    case 'Watchlist':
      await navTop(page, 'Portfolio');
      return section(page, 'Watchlist');
    // Options opens as a browsable long-call ladder. A named contract is a
    // direct intent, so it opens its own ticket from the product menu.
    case 'Trade':
      await navTop(page, 'Trade');
      return section(page, 'Options');
    case 'Underwrite':
      return pick(page, 'Trade', 'Covered call');
    case 'Structures':
      await navTop(page, 'Trade');
      return section(page, 'Structures');
    case 'Convexity structures':
      return pick(page, 'Trade', 'Convexity');
    case 'Lending':
      return pick(page, 'Lending', 'Lend');
    case 'Lending short':
      return pick(page, 'Lending', 'Short');
    case 'Lending spot':
      return pick(page, 'Lending', 'Spot');
    case 'Lending markets':
      return pick(page, 'Lending', 'Markets');
    case 'Lending positions':
      await navTop(page, 'Portfolio');
      return section(page, 'Holdings');
    case 'Pre-IPO':
      return navTop(page, 'Pre-IPO');
    default:
      return navTop(page, name);
  }
}

/** Basic hides the leg editor and the Greeks; Advanced is a switch. */
export async function advanced(page: Page, on = true) {
  const toggle = page.locator('.od-switch');
  if ((await toggle.getAttribute('aria-pressed')) !== String(on))
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(on));
}

/** Pick a bounded expiry-menu item. The short tenor follows the stable date
 * in its accessible name, so the date itself stays a reliable test handle. */
export async function pickExpiry(page: Page, date: string) {
  const [year, month, day] = date.slice(0, 10).split('-');
  const label = `${month}/${day}/${year}`;
  await page.getByLabel('Contract expiry', { exact: true }).click();
  await page
    .locator('.od-expiry-menu')
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click();
}

/** Cash moves in and out through the wallet in the top bar. */
export async function openUsdcDeposit(page: Page) {
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deposit USDC', exact: true })
    .click();
}

export async function deposit(
  page: Page,
  asset: 'USDC' | 'NVDA',
  amount: string,
) {
  await nav(page, 'Vault');
  // Stock deposits from its row; cash from the wallet in the top bar.
  if (asset === 'USDC') await openUsdcDeposit(page);
  else
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
  // Session travel is deliberately absent from the customer desk. It is a
  // test-harness concern, so drive the same revision-checked endpoint the
  // former control used and reload the persisted session afterwards.
  await page.evaluate(async (next) => {
    const snapshot = await fetch('/api/vault').then((response) =>
      response.json(),
    );
    const response = await fetch('/api/vault/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': snapshot.csrf,
        'Idempotency-Key': `e2e-advance-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        revision: snapshot.revision,
        action: { type: 'advance', date: next },
      }),
    });
    if (!response.ok) throw Error(await response.text());
  }, date);
  await page.reload();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
}

export async function restartReplay(page: Page) {
  await page.evaluate(async () => {
    const snapshot = await fetch('/api/vault').then((response) =>
      response.json(),
    );
    const response = await fetch('/api/vault/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': snapshot.csrf,
        'Idempotency-Key': `e2e-restart-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        revision: snapshot.revision,
        action: { type: 'restart' },
      }),
    });
    if (!response.ok) throw Error(await response.text());
  });
  await page.reload();
  await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
}

/** The quote the backend actually priced, not what the form claims. */
export function quoteFor(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
  );
}
