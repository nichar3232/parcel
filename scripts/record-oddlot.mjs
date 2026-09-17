/** Records the real same-origin Parcel UI, API and configured local-validator execution. */
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.ODDLOT_URL;
if (!base) throw Error('Set ODDLOT_URL to the review server.');
const media = path.resolve('.state/oddlot-media');
await mkdir(media, { recursive: true });
const nav = async (name) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true })
    .click();
async function deposit(asset, amount) {
  await page
    .getByRole('button', { name: `Deposit ${asset}`, exact: true })
    .click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
}
async function order() {
  await page.getByRole('button', { name: 'Review funded quote' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(2800);
  await page
    .getByRole('button', { name: 'Confirm contract', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
}
async function advance(date) {
  await page.locator('.od-market-button').click();
  await page.getByLabel('Advance to session').selectOption(date);
  await page
    .getByRole('button', { name: 'Advance & settle due positions' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
}
const scenes = [
  [
    'Parcel lets you size equity options to your actual exposure. One share is a denomination, not a minimum lot. This is the working product: historical NVIDIA prices, model premiums, and disclosed test liquidity. Our vault executes on a private Solana validator.',
    async () => {
      await page.goto(`${base}/app`);
      await expect(page.locator('.oddlot')).toHaveAttribute(
        'data-ready',
        'true',
      );
      await expect(page.locator('.od-footer')).toContainText(
        'Solana local validator',
      );
    },
  ],
  [
    'Start with cash and stock deposits. These move real SPL test tokens into program controlled escrow. Both sides of a contract must be funded, and pledged collateral cannot be spent twice.',
    async () => {
      await deposit('USDC', '500');
      await deposit('NVDA', '2');
    },
  ],
  [
    'Underwrite exactly one third of a share. The covered call chart includes the stock: a sharp decline still loses money despite collecting premium. The final confirmation lists the strike, side, ratio, exact price, and remaining collateral before we execute.',
    async () => {
      await nav('Underwrite');
      await page.getByLabel('Contract quantity').fill('0.333333');
      await page.getByLabel('Reference price move').fill('-30');
      await page.waitForTimeout(3000);
      await order();
      await page.screenshot({
        path: 'docs/audit/2026-09-15-release/covered-call.png',
        fullPage: true,
      });
    },
  ],
  [
    'Smaller contracts do not erase exercise funding. This long call needs one hundred forty five dollars of strike cash plus its premium. Reducing the quantity to one tenth reduces both dollar amounts. Cash settled spreads provide a different, bounded alternative.',
    async () => {
      await nav('Trade');
      await page.waitForTimeout(5000);
      await page.getByLabel('Contract quantity').fill('0.1');
      await order();
    },
  ],
  [
    'Structures combine up to four explicit option legs. Here a cash settled call spread caps the payoff and its reserve. Cross collateral only offsets obligations sharing the same reference, expiration, and settlement type.',
    async () => {
      await nav('Structures');
      await page.getByLabel('Contract quantity').fill('0.25');
      await order();
    },
  ],
  [
    'The stock borrower actually sells the borrowed shares. It pays for a covered protective call and escrows the maximum repurchase cost plus interest. The test market reserves the backing stock. This demonstrates productive borrowing, but it does not claim an external lender or market maker.',
    async () => {
      await nav('Lending');
      await page.getByLabel('Share quantity').fill('0.1');
      await page.getByRole('button', { name: 'Review stock loan' }).click();
      await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'Confirm transaction' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
    },
  ],
  [
    'The risk view connects the contracts to available capital. It shows exactly which cash and stock are reserved. The program independently calculates the same obligations, so a mismatched backend result cannot commit.',
    async () => {
      await nav('Risk');
      await page.screenshot({
        path: 'docs/audit/2026-09-15-release/risk.png',
        fullPage: true,
      });
    },
  ],
  [
    'Advance to the stored expiry. Options settle together and the borrower repurchases the loaned stock. Activity records the confirmed Solana transaction and verified slot. After the last historical session, restart the replay without losing the audit receipts.',
    async () => {
      await advance('2025-02-07');
      await nav('Activity');
      await expect(
        page.getByRole('heading', { name: 'Confirmed on Solana localnet' }),
      ).toBeVisible();
      await page.screenshot({
        path: 'docs/audit/2026-09-15-release/chain-activity.png',
        fullPage: true,
      });
      const result = await (await page.request.get('/api/vault')).json();
      if (result.mode !== 'localnet' || !result.chain?.signature)
        throw Error('No confirmed Parcel execution.');
      await writeFile(
        'submission/oddlot-ui-evidence.json',
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            mode: result.mode,
            revision: result.revision,
            chain: result.chain,
            book: result.book,
            risk: result.risk,
          },
          null,
          2,
        ) + '\n',
      );
      await advance('2025-04-03');
      await page.locator('.od-market-button').click();
      await expect(
        page.getByRole('button', { name: 'Restart historical replay' }),
      ).toBeVisible();
    },
  ],
];
const clips = [];
for (let i = 0; i < scenes.length; i++) {
  const file = path.join(media, `voice-${i}.aiff`);
  execFileSync('say', [
    '-v',
    'Samantha',
    '-r',
    '161',
    '-o',
    file,
    scenes[i][0],
  ]);
  const info = execFileSync('afinfo', [file], { encoding: 'utf8' });
  const match = info.match(/estimated duration:\s*([\d.]+)/);
  if (!match) throw Error('Cannot measure audio');
  clips.push({
    file: path.basename(file),
    text: scenes[i][0],
    duration: Number(match[1]),
  });
}
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {},
);
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: media, size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const video = page.video(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const began = performance.now();
try {
  for (let i = 0; i < scenes.length; i++) {
    clips[i].start = (performance.now() - began) / 1000;
    await scenes[i][1]();
    await page.waitForTimeout(
      Math.max(
        0,
        (clips[i].duration +
          0.7 -
          ((performance.now() - began) / 1000 - clips[i].start)) *
          1000,
      ),
    );
    console.log(`Recorded scene ${i + 1}`);
  }
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await context.close();
  await video.saveAs(path.join(media, 'walkthrough.webm'));
  await browser.close();
}
await writeFile(
  path.join(media, 'timeline.json'),
  JSON.stringify(clips, null, 2) + '\n',
);
await writeFile(
  'submission/demo-timeline.json',
  JSON.stringify(
    clips.map(({ file: _file, ...rest }) => rest),
    null,
    2,
  ) + '\n',
);
await writeFile(
  'submission/narration.txt',
  clips.map((c) => c.text).join('\n\n') + '\n',
);
console.log('Verified recording ready for encode-oddlot.py.');
