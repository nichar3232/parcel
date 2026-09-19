import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output = process.env.PARCEL_UI_OUTPUT || '/tmp/parcel-product-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(
    (process.env.PARCEL_UI_URL || 'http://127.0.0.1:3030') + '/app',
  );
  await page.locator('.parcel[data-ready="true"]').waitFor();
  const nav = async (name) => {
    const toggle = page.getByRole('button', { name: 'Open navigation' });
    if (await toggle.isVisible()) await toggle.click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true })
      .click();
    await page.locator('.od-sidebar.open').waitFor({ state: 'detached' });
  };
  await nav('Trade');
  await page
    .getByRole('button', { name: 'Options chain', exact: true })
    .click();
  await page.locator('.od-chain-table').waitFor();
  await page.screenshot({
    path: `${output}/chain-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await nav('Structures');
  await page.getByRole('button', { name: 'Convexity', exact: true }).click();
  await page
    .getByRole('button', { name: /CONVEXITY Capped quadratic/ })
    .click();
  await page.screenshot({
    path: `${output}/curve-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.od-order-form').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${output}/curve-mobile.png`,
    animations: 'disabled',
  });
  await nav('Trade');
  await page
    .getByRole('button', { name: 'Options chain', exact: true })
    .click();
  await page.locator('.od-chain-mobile .od-chain-card').first().waitFor();
  await page.screenshot({
    path: `${output}/chain-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error('Mobile overflow');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ passed: true, output }));
} finally {
  await browser.close();
}
