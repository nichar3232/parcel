// Drives the landing page and the vault -> builder -> quote path,
// capturing each screen. Usage: node scripts/walkthrough.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3025';
const out = process.argv[3] || 'artifacts/walkthrough';
const shots = [];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name, opts = {}) {
  await page.screenshot({ path: `${out}/${name}.png`, ...opts });
  shots.push(name);
  console.log(`  ✓ ${name}`);
}

const nav = (page, name) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true })
    .click();

/** Underwrite and Structures are modes inside Trade. */
const tradeMode = async (page, mode) => {
  await nav(page, 'Trade');
  await page
    .getByRole('group', { name: 'Trading mode' })
    .getByRole('button', { name: mode, exact: true })
    .click();
};

async function run(width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log(`\n${tag} (${width}x${height})`);

  await page.goto(base, { waitUntil: 'networkidle' });
  await shoot(page, `${tag}-01-landing-hero`);
  await shoot(page, `${tag}-02-landing-full`, { fullPage: true });

  await page
    .getByRole('link', { name: /launch app/i })
    .first()
    .click();
  await page.waitForURL('**/app');
  await page.waitForSelector('.oddlot[data-ready="true"]');
  await shoot(page, `${tag}-03-vault`, { fullPage: true });

  const mobile = width < 900;
  if (mobile)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await tradeMode(page, 'Structures');
  await page.waitForSelector('.od-builder-grid');
  await shoot(page, `${tag}-04-structures`, { fullPage: true });

  // size the spread past a single share, then take a funded quote
  await page.getByLabel('Contract quantity').fill('8');
  await page.waitForTimeout(400);
  await shoot(page, `${tag}-05-sized`);
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await page.getByRole('dialog').waitFor();
  await shoot(page, `${tag}-06-quote`);
  await page
    .getByRole('button', { name: /close|cancel/i })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(300);

  if (mobile)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  // Risk is a section of Portfolio now, not its own destination.
  await nav(page, 'Portfolio');
  await page.locator('.od-section-break').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, `${tag}-07-portfolio-risk`, { fullPage: true });

  await ctx.close();
  return errors;
}

const errors = [
  ...(await run(1440, 900, 'desktop')),
  ...(await run(390, 844, 'mobile')),
].filter((e) => !/favicon|og\.png/i.test(e));
await browser.close();

console.log(`\n${shots.length} screens captured to ${out}/`);
if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of new Set(errors)) console.log(`  ! ${e}`);
  process.exit(1);
}
console.log('No console errors.');
