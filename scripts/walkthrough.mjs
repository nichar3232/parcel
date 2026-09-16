// Drives the landing page and the four-step build flow, capturing each screen.
// Usage: node scripts/walkthrough.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3025';
const out = process.argv[3] || 'artifacts/walkthrough';
const shots = [];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name, opts = {}) {
  const file = `${out}/${name}.png`;
  await page.screenshot({ path: file, ...opts });
  shots.push(name);
  console.log(`  ✓ ${name}`);
}

async function run(width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log(`\n${tag} (${width}x${height})`);

  // --- landing ---
  await page.goto(base, { waitUntil: 'networkidle' });
  await shoot(page, `${tag}-01-landing-hero`);
  await shoot(page, `${tag}-02-landing-full`, { fullPage: true });

  // --- enter the desk via the CTA, proving the landing links through ---
  await page
    .getByRole('link', { name: /build a position/i })
    .first()
    .click();
  await page.waitForURL('**/app');
  await page
    .getByRole('heading', { name: /what are you trying to do/i })
    .waitFor();
  await shoot(page, `${tag}-03-step1-intent`);

  // --- step 1 -> 2 ---
  await page.getByRole('button', { name: /explore the upside/i }).click();
  await page.getByRole('heading', { name: /how much of it/i }).waitFor();
  await shoot(page, `${tag}-04-step2-size`);

  // change the size to prove the figures are live
  await page.getByRole('button', { name: /^size 0\.5 shares$/i }).click();
  await shoot(page, `${tag}-05-step2-resized`);

  // --- step 2 -> 3 ---
  await page.getByRole('button', { name: /review the payoff/i }).click();
  await page.getByRole('heading', { name: /here is the trade-off/i }).waitFor();
  await page.waitForTimeout(400); // let the payoff chart settle
  await shoot(page, `${tag}-06-step3-review`);

  // --- step 3 -> 4 ---
  await page.getByRole('button', { name: /fund this position/i }).click();
  await page.getByRole('heading', { name: /^fund it\.$/i }).waitFor();
  await shoot(page, `${tag}-07-step4-fund`);

  // --- hand off to the builder ---
  await page.getByRole('button', { name: /open in the builder/i }).click();
  await page.waitForTimeout(700);
  await shoot(page, `${tag}-08-builder`);

  await ctx.close();
  return errors;
}

const desktopErrors = await run(1440, 900, 'desktop');
const mobileErrors = await run(390, 844, 'mobile');
await browser.close();

const errors = [...desktopErrors, ...mobileErrors].filter(
  (e) => !/favicon|og\.png/i.test(e),
);
console.log(`\n${shots.length} screens captured to ${out}/`);
if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of new Set(errors)) console.log(`  ! ${e}`);
  process.exit(1);
}
console.log('No console errors.');
