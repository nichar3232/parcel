// Drives the landing page and the four-step build flow, capturing each screen.
// Usage: node scripts/walkthrough.mjs [baseUrl] [outDir] [--headful]
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2]?.startsWith('http')
  ? process.argv[2]
  : 'http://localhost:3025';
const out = process.argv.find((a, i) => i > 2 && !a.startsWith('--'))
  ? process.argv[3]
  : 'artifacts/walkthrough';
const headful = process.argv.includes('--headful');
const shots = [];

await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  headless: !headful,
  defaultViewport: null,
  args: ['--hide-scrollbars'],
});

async function shoot(page, name, opts = {}) {
  await page.screenshot({ path: `${out}/${name}.png`, ...opts });
  shots.push(name);
  console.log(`  ✓ ${name}`);
}

/** Click the first element whose visible text or aria-label matches. */
async function click(page, pattern, { tag = 'button, a' } = {}) {
  const handle = await page.evaluateHandle(
    (sel, src) => {
      const re = new RegExp(src, 'i');
      return (
        [...document.querySelectorAll(sel)].find(
          (el) =>
            re.test(el.textContent.replace(/\s+/g, ' ').trim()) ||
            re.test(el.getAttribute('aria-label') || ''),
        ) || null
      );
    },
    tag,
    pattern.source ?? pattern,
  );
  const el = handle.asElement();
  if (!el) throw Error(`no element matching ${pattern}`);
  await el.click();
}

/** Wait until the step heading matches, so we never shoot a half-rendered step. */
const waitHeading = (page, re) =>
  page.waitForFunction(
    (src) =>
      new RegExp(src, 'i').test(
        document.querySelector('.gf-head h1, .lp-hero h1')?.textContent || '',
      ),
    { timeout: 15000 },
    re.source,
  );

async function run(width, height, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  // Console errors omit the URL, so failed responses are tracked separately
  // and matched by URL -- otherwise a stray 404 is indistinguishable.
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) =>
    errors.push(`failed ${r.url()} ${r.failure()?.errorText || ''}`),
  );
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log(`\n${tag} (${width}x${height})`);

  // --- landing ---
  await page.goto(base, { waitUntil: 'networkidle0' });
  await shoot(page, `${tag}-01-landing-hero`);
  await shoot(page, `${tag}-02-landing-full`, { fullPage: true });

  // --- enter the desk via the CTA, proving the landing links through ---
  await click(page, /build a position/);
  await page.waitForFunction(() => location.pathname === '/app', {
    timeout: 15000,
  });
  await page.waitForSelector('.oddlot[data-ready="true"]', { timeout: 15000 });
  await waitHeading(page, /what are you trying to do/);
  await shoot(page, `${tag}-03-step1-intent`);

  // --- step 1 -> 2 ---
  await click(page, /explore the upside/);
  await waitHeading(page, /how much of it/);
  await shoot(page, `${tag}-04-step2-size`);

  // change the size to prove the figures are live
  await click(page, /^size 0\.5 shares$/);
  await page.waitForFunction(
    () => document.querySelector('.gf-size-read strong')?.textContent === '0.5',
    { timeout: 15000 },
  );
  await shoot(page, `${tag}-05-step2-resized`);

  // --- step 2 -> 3 ---
  await click(page, /review the payoff/);
  await waitHeading(page, /here is the trade-off/);
  await page.waitForSelector('.od-chart-caption', { timeout: 15000 });
  await shoot(page, `${tag}-06-step3-review`);

  // --- step 3 -> 4 ---
  await click(page, /fund this position/);
  await waitHeading(page, /fund it\./);
  await shoot(page, `${tag}-07-step4-fund`);

  // --- hand off to the builder ---
  await click(page, /open in the builder/);
  await page.waitForSelector('.od-builder-grid', { timeout: 15000 });
  await shoot(page, `${tag}-08-builder`);

  await page.close();
  return errors;
}

const desktopErrors = await run(1440, 900, 'desktop');
const mobileErrors = await run(390, 844, 'mobile');
await browser.close();

const errors = [...desktopErrors, ...mobileErrors];
console.log(`\n${shots.length} screens captured to ${out}/`);
if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of new Set(errors)) console.log(`  ! ${e}`);
  process.exit(1);
}
console.log('No page errors, failed requests or bad responses.');
