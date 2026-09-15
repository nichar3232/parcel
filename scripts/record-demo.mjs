/** Record the actual private app and real test-chain lifecycle. No rendered mock screens. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const base = process.env.STRATA_URL;
if (!base) throw Error('Set STRATA_URL to the private working deployment.');
const ffmpeg = process.env.FFMPEG || 'ffmpeg',
  media = path.resolve('.state/media');
await mkdir(media, { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {},
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: media, size: { width: 1440, height: 900 } },
});
const page = await context.newPage(),
  video = page.video(),
  began = performance.now(),
  audio = [],
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function scene(text, work, minimum = 0) {
  const file = path.join(media, `voice-${audio.length}.aiff`);
  execFileSync('say', ['-v', 'Samantha', '-r', '155', '-o', file, text]);
  const match = spawnSync(ffmpeg, ['-i', file, '-f', 'null', '-'], {
    encoding: 'utf8',
  }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!match) throw Error('Could not measure narration');
  const duration =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const start = (performance.now() - began) / 1000;
  audio.push({ file, text, start, duration });
  await writeFile(path.join(media,"timeline.json"),JSON.stringify(audio));
  console.log(`Scene ${audio.length}: ${text.slice(0, 65)}`);
  await work();
  await page.waitForTimeout(
    Math.max(
      0,
      (Math.max(duration + 0.6, minimum) -
        (performance.now() - began) / 1000 +
        start) *
        1000,
    ),
  );
}
try {
  await scene(
    'Strata makes stock protection understandable and verifiable. This is the working application, with a persistent backend and historical NVIDIA market data.',
    async () => {
      await page.goto(base);
      await expect(
        page.getByText('Connecting to your saved portfolio…'),
      ).toHaveCount(0);
    },
  );
  await scene(
    'Choose a bounded put spread. One hundred share equivalents, a one hundred twenty to one hundred forty dollar range, and an illustrative four hundred dollar premium.',
    async () => {
      await page
        .getByRole('button', { name: 'Protect a position', exact: true })
        .click();
    },
  );
  await scene(
    'First, fund a real Solana contract. The maker deposits the full two thousand dollar maximum payout into program controlled test token escrow.',
    async () => {
      await page
        .getByRole('button', { name: 'Try this contract on Solana' })
        .click();
      await page
        .getByRole('button', { name: 'Maker: fund this offer' })
        .click();
      await expect(
        page.getByRole('button', { name: /Holder: accept/ }),
      ).toBeEnabled({ timeout: 30000 });
    },
  );
  await scene(
    'The holder accepts those exact terms. These are separate test wallets on an isolated Solana validator. The ninety second observation clock is now running.',
    async () => {
      await page.getByRole('button', { name: /Holder: accept/ }).click();
      await expect(page.getByRole('dialog').locator('.status')).toHaveText(
        'Active',
        { timeout: 30000 },
      );
      await page.keyboard.press('Escape');
    },
  );
  await scene(
    'While that contract matures, the practice desk shows the same lifecycle. Request a quote, switch to the maker, and reserve its maximum payout.',
    async () => {
      await page
        .getByRole('button', { name: 'Request a funded quote' })
        .click();
      await page
        .getByRole('button', { name: 'Fund offer · $2,000.00' })
        .click();
      await page.getByRole('button', { name: 'Review as holder' }).click();
    },
  );
  await scene(
    'The funded offer makes the premium and collateral visible before acceptance. Cash moves only after the holder accepts. The backend saves every transition.',
    async () => {
      await page.getByRole('button', { name: /Accept.*400/ }).click();
      await expect(page.getByRole('dialog').locator('.status')).toHaveText(
        'Active',
      );
      await page.getByRole('button', { name: 'Advance to expiry' }).click();
    },
  );
  await scene(
    'A missing observation must never release collateral. Here the contract waits for data, then settles against the exact committed historical close of one hundred eighteen dollars and forty two cents.',
    async () => {
      await page.getByLabel('Simulate missing oracle data').check();
      await page
        .getByRole('button', { name: 'Settle position', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toContainText('Awaiting data');
      await page.waitForTimeout(1800);
      await page.getByLabel('Simulate missing oracle data').uncheck();
      await page.getByRole('button', { name: 'Retry settlement' }).click();
      await expect(page.getByRole('dialog')).toContainText(
        'Settled at $118.42',
      );
    },
  );
  await scene(
    'The holder claims two thousand dollars. The maker claims the remainder. Both claims close the contract, and the portfolio reconciles every unit.',
    async () => {
      await page
        .getByRole('button', { name: 'Claim as holder · $2,000.00' })
        .click();
      await expect(
        page.getByRole('button', { name: 'Holder claimed' }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Claim as maker · $0.00' })
        .click();
      await expect(page.getByRole('dialog').locator('.status')).toHaveText(
        'Closed',
      );
      await page.keyboard.press('Escape');
    },
  );
  await scene(
    'The replay makes the outcome tangible. The stock lost two thousand four hundred twenty dollars. After the hedge and premium, the combined loss is eight hundred twenty.',
    async () => {
      await page.getByRole('button', { name: /^Replay lab/ }).click();
      await page
        .locator('.comparison-panel')
        .count()
        .then(async (count) => {
          if (count)
            await page.locator('.comparison-panel').scrollIntoViewIfNeeded();
        });
    },
  );
  await scene(
    'Tokenized stocks also introduce basis and issuer risks. A simulated token discount shows what an equity reference hedge cannot cover. Borrowing remains clearly separated from verified execution.',
    async () => {
      await page.locator('#basis').scrollIntoViewIfNeeded();
      await page.locator('#basis').fill('3');
    },
  );
  await scene(
    'Now return to the real Solana contract. Its historical observation was committed before funding. Settlement fixes each entitlement, and the program pays both parties exactly once.',
    async () => {
      await page.getByRole('button', { name: 'Build', exact: true }).click();
      await page
        .getByRole('button', { name: 'Try this contract on Solana' })
        .click();
      await expect(
        page.getByRole('button', { name: 'Settle on Solana' }),
      ).toBeEnabled({ timeout: 100000 });
      await page.getByRole('button', { name: 'Settle on Solana' }).click();
      await expect(
        page.getByRole('button', { name: 'Holder: claim $2,000.00' }),
      ).toBeEnabled({ timeout: 30000 });
      await page
        .getByRole('button', { name: 'Holder: claim $2,000.00' })
        .click();
      await expect(
        page.getByRole('button', { name: 'Maker: claim remainder' }),
      ).toBeEnabled({ timeout: 30000 });
      await page
        .getByRole('button', { name: 'Maker: claim remainder' })
        .click();
      await expect(page.getByRole('dialog').locator('.status')).toHaveText(
        'Closed',
        { timeout: 30000 },
      );
    },
  );
  await scene(
    'The escrow is empty, and every confirmed transaction can be inspected. Strata is a working test value demonstrator: clear payoffs, fully reserved obligations, and recoverable settlement.',
    async () => {
      await page.screenshot({
        path: 'docs/audit/screenshots/live-chain-closed.png',
        fullPage: true,
      });
      const response = await page.request.get(`${base}/api/chain/positions`);
      const positions = await response.json();
      const p = positions[0];
      if (
        p.status !== 'closed' ||
        p.escrow !== 0 ||
        p.transactions.length !== 5
      )
        throw Error('Recorded chain lifecycle did not reconcile.');
      await writeFile(
        'submission/ui-chain-evidence.json',
        JSON.stringify(
          { recordedAt: new Date().toISOString(), position: p },
          null,
          2,
        ),
      );
    },
  );
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await context.close();
  await video.saveAs(path.join(media, 'walkthrough.webm'));
  await browser.close();
}
const inputs = ['-y', '-i', path.join(media, 'walkthrough.webm')];
for (const clip of audio) inputs.push('-i', clip.file);
const filters = audio.map(
  (clip, i) =>
    `[${i + 1}:a]adelay=${Math.round(clip.start * 1000)}:all=1[a${i}]`,
);
filters.push(
  audio.map((_, i) => `[a${i}]`).join('') +
    `amix=inputs=${audio.length}:normalize=0,apad[mixed]`,
);
execFileSync(
  ffmpeg,
  [
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v',
    '-map',
    '[mixed]',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    'submission/strata-demo.mp4',
  ],
  { stdio: 'ignore' },
);
await writeFile(
  'submission/narration.txt',
  audio.map((c) => c.text).join('\n\n') + '\n',
);
await writeFile(
  'submission/demo-timeline.json',
  JSON.stringify(
    audio.map(({ text, start, duration }) => ({ text, start, duration })),
    null,
    2,
  ),
);
console.log(
  'Recorded, narrated, and verified the actual UI and test-chain lifecycle.',
);
