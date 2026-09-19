import { expect, type Page } from '@playwright/test';

/**
 * One way to drive the desk from a test.
 *
 * The shell owns navigation: four destinations across the top, and each
 * destination's sections in a menu that is open only while that
 * destination is. Every spec was reaching into that structure itself,
 * with three different ideas of where a view lived, so the helpers live
 * here and the specs say what they mean.
 *
 * The menu is the part worth knowing. Taking a section or a choice
 * closes it, so the element just clicked is gone by the next line: the
 * confirmation is the menu's disappearance, never the link's state.
 */

/** Match a label whole, so 'Lend' never selects 'Lend & borrow'. */
const whole = (name: string) =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const rail = (page: Page) =>
  page.getByRole('navigation', { name: 'Main navigation' });

/**
 * The open destination's menu.
 *
 * Arriving at a destination opens it. Taking a section, or moving the
 * pointer off the nav, closes it again — so reopen it by hovering
 * whichever destination is currently marked.
 */
/**
 * Take the pointer off the nav and wait for the menu to settle shut.
 *
 * Choosing closes the menu, but the pointer is left where the menu used
 * to be — and at narrow widths the bar wraps, so that spot can be a
 * destination, whose hover would immediately open it again.
 */
async function leaveNav(page: Page) {
  await page.mouse.move(0, 400);
  await expect(rail(page).locator('.od-nav-menu')).toHaveCount(0);
}

export async function openMenu(page: Page) {
  const menu = rail(page).locator('.od-nav-menu');
  if (await menu.count()) return menu;
  // Only a fresh pointer entry opens it, and the pointer is usually
  // still resting on the destination that was just clicked — where a
  // hover moves nothing and so fires nothing. Leave the nav first.
  // (Landing on a destination opens its menu, but the same click then
  // toggles it shut again when that destination was already current.)
  await page.mouse.move(0, 400);
  await rail(page).locator('.od-nav-item[aria-current="page"]').hover();
  await menu
    .first()
    .waitFor({ state: 'visible', timeout: 2000 })
    .catch(() => {
      /* a destination with one plain section never opens a menu */
    });
  return menu;
}

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

/** The four destinations across the top. */
export async function navTop(page: Page, name: string) {
  const item = rail(page).getByRole('button', { name, exact: true });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
}

/**
 * A section within the current destination.
 *
 * A destination whose one section offers no choices has no menu at all,
 * so arriving at the destination is arriving at the section and there
 * is nothing here to click.
 */
export async function section(page: Page, name: string) {
  const menu = await openMenu(page);
  // No menu means the destination has a single plain section: arriving
  // is arriving. A menu that lacks the section is a real fault, so let
  // the click report it rather than passing silently and failing three
  // assertions later on the wrong screen.
  if ((await menu.count()) === 0) return;
  await rail(page)
    .locator('.od-nav-link')
    .filter({ hasText: whole(name) })
    .first()
    .click();
  await leaveNav(page);
}

/**
 * A choice within a section, taken straight from the menu.
 *
 * A choice sets its section and itself in one click, which is why this
 * does not select the section first: doing that would close the menu
 * and take the choice with it.
 */
export async function pick(page: Page, name: string) {
  await openMenu(page);
  const choice = rail(page)
    .locator('.od-nav-pick')
    .filter({ hasText: whole(name) });
  await choice.first().click();
  await leaveNav(page);
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
      return pick(page, 'Long call');
    case 'Underwrite':
      await navTop(page, 'Trade');
      return pick(page, 'Covered call');
    case 'Structures':
      await navTop(page, 'Trade');
      return section(page, 'Structures');
    case 'Lending':
      await navTop(page, 'Lending');
      return section(page, 'Lend & borrow');
    // "Rates" is gone: it tabled five reserves this build cannot lend,
    // borrow or short. The one rate that matters is on the ticket.
    case 'Lending markets':
      await navTop(page, 'Lending');
      return section(page, 'Lend & borrow');
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

/**
 * Move the replay clock on.
 *
 * The desk no longer offers this: nothing in the product dispatches an
 * `advance`, so there is no control left to drive. The clock is backend
 * state, so the spec asks the backend for it through the page's own
 * session, then lets the desk refetch.
 *
 * Refetching rather than reloading is deliberate — a reload drops
 * whichever view the spec had open, and most callers keep working on
 * that view straight after.
 */
async function vaultAction(page: Page, action: Record<string, unknown>) {
  const result = await page.evaluate(async (a) => {
    const session = await fetch('/api/session').then((r) => r.json());
    const vault = await fetch('/api/vault').then((r) => r.json());
    const response = await fetch('/api/vault/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ revision: vault.revision, action: a }),
    });
    return { ok: response.ok, body: await response.text() };
  }, action);
  if (!result.ok)
    throw Error(`${JSON.stringify(action)} failed: ${result.body}`);
  // The desk refetches on window focus; its own GET is the signal that
  // the view has caught up with the backend.
  const caughtUp = page.waitForResponse(
    (r) => r.url().endsWith('/api/vault') && r.request().method() === 'GET',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await caughtUp;
}

export async function advance(page: Page, date: string) {
  await vaultAction(page, { type: 'advance', date });
}

/** Start the historical replay over; the desk offers no control for it. */
export async function restart(page: Page) {
  await vaultAction(page, { type: 'restart' });
}

/** The quote the backend actually priced, not what the form claims. */
export function quoteFor(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/vault/quote') && r.request().method() === 'POST',
  );
}

/**
 * An open contract in the positions list.
 *
 * Positions are no longer a table, so they have no row or cell roles:
 * each one is a `.od-pos-row` whose text is the contract's name, then
 * its size, underlying and expiry.
 */
export function positionRow(page: Page, name: string) {
  return page.locator('.od-pos-row').filter({ hasText: name });
}

/**
 * The ticket's payoff side.
 *
 * Trade opens on the chain, so the payoff, its greeks and the value
 * surface are behind the other half of the builder-source switch.
 * Structures opens on the payoff already and shows no switch, so this
 * is a no-op there.
 */
export async function payoff(page: Page) {
  const source = page.getByRole('group', { name: 'Builder source' });
  if ((await source.count()) === 0) return;
  await source.getByRole('button', { name: 'Payoff', exact: true }).click();
}

/**
 * A holding in the vault's asset list.
 *
 * Assets share the positions list's row class, so they need their own
 * modifier to be told apart from an open contract.
 */
export function assetRow(page: Page, name: string) {
  return page.locator('.od-pos-asset').filter({ hasText: name });
}

/** The ticket's chain side; Trade opens here, Structures has no switch. */
export async function chain(page: Page) {
  const source = page.getByRole('group', { name: 'Builder source' });
  if ((await source.count()) === 0) return;
  await source.getByRole('button', { name: 'Chain', exact: true }).click();
}
