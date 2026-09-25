// Clicks through the desk the way the demo shows it, in a visible browser
// with an on-screen cursor, then hands the vault to an agent over MCP and
// waits for its trade to land in Activity. Every step asserts, so a clean
// exit is the proof that the demo can be run.
//
//   npm run demo:agent                  fresh sandbox server, headed
//   PARCEL_URL=http://host:3025 npm run demo:agent    an existing server
//   HEADLESS=1 PACE=0 npm run demo:agent              as a quick check
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const headless = process.env.HEADLESS === '1';
/** Seconds a viewer gets on each screen; 0 runs straight through. */
const pace = Number(process.env.PACE ?? 1.6);
const port = Number(process.env.PORT ?? 3033);
let base = process.env.PARCEL_URL;
let server;

if (!base) {
  // A fresh state directory, so every run starts from the same seeded vault.
  const state = await mkdtemp(path.join(tmpdir(), 'parcel-demo-'));
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      STRATA_STATE_DIR: state,
      PARCEL_DEMO: '1',
      CHAIN_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (i > 60) throw Error(`The server did not start on ${base}.`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// The cursor a viewer follows. Playwright's own pointer is invisible.
await page.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    dot.style.cssText =
      'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(92,214,255,.35);border:2px solid #5cd6ff;pointer-events:none;transition:transform .12s;left:-40px;top:-40px';
    document.body.append(dot);
    addEventListener('mousemove', (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    });
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'));
    addEventListener('mouseup', () => (dot.style.transform = ''));
  });
});

const beat = (n = 1) => page.waitForTimeout(pace * 1000 * n);

/** Glide to an element, then click it, so the viewer sees where it went. */
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw Error(`Nothing to click: ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: pace ? 20 : 1,
  });
  await page.waitForTimeout(pace ? 250 : 0);
  await locator.click();
}

const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true });

/** Open a product's menu and choose from it. */
async function choose(product, item, kind = '.od-nav-pick') {
  if ((await nav(product).getAttribute('aria-expanded')) !== 'true')
    await click(nav(product));
  await click(page.locator(kind, { hasText: item }).first());
}

async function scene(title, fn) {
  const started = Date.now();
  await fn();
  console.log(`  ✓ ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

try {
  console.log(`Parcel agent demo on ${base}`);

  await scene('Open the desk', async () => {
    await page.goto(`${base}/app`);
    await expect(page.locator('.pc-desk')).toHaveAttribute(
      'data-ready',
      'true',
    );
    const skip = page.getByRole('button', { name: 'Skip', exact: true });
    if (await skip.isVisible().catch(() => false)) {
      await beat();
      await click(skip);
    }
    await expect(page.getByText('Vault value', { exact: false })).toBeVisible();
    await beat(1.5);
  });

  await scene('Browse the options ladder', async () => {
    await click(nav('Trade'));
    await choose('Trade', 'Long call');
    await expect(page.getByText('Model ask').first()).toBeVisible();
    await beat(1.5);
  });

  await scene('Build an iron condor in Advanced', async () => {
    await choose('Trade', 'Volatility');
    await click(page.getByText('Iron condor', { exact: true }));
    const toggle = page.locator('.od-switch');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true')
      await click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Four legs: the put wing, the short put, the short call, the call wing.
    await expect(page.locator('.od-payoff-stats')).toContainText('Max loss');
    await beat(2);
  });

  await scene('Read its value across price and time', async () => {
    const surface = page.getByText('Value across price and time');
    await surface.scrollIntoViewIfNeeded();
    await page.mouse.move(500, 520, { steps: pace ? 30 : 1 });
    await beat(2.5);
  });

  await scene('Review and confirm the funded quote', async () => {
    await click(page.getByRole('button', { name: 'Review funded quote' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Iron condor');
    await beat(2);
    await click(
      page.getByRole('button', { name: 'Confirm contract', exact: true }),
    );
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Vault updated')).toBeVisible();
    await beat();
  });

  await scene('Borrow cash against stock at a fixed rate', async () => {
    await choose('Lending', 'Borrow');
    await click(page.locator('button', { hasText: /^Fixed$/ }));
    await beat();
    await click(page.getByRole('button', { name: 'Review cash loan' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('fixed until');
    await beat(2);
    await click(
      page.getByRole('button', { name: 'Confirm transaction', exact: true }),
    );
    await expect(dialog).toHaveCount(0);
    await beat();
  });

  let key;
  await scene('Connect Claude', async () => {
    await click(page.getByRole('button', { name: 'Connect an agent' }));
    await expect(page.locator('.od-agent-url code').first()).toHaveText(
      `${base}/mcp`,
    );
    await beat(2.5);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The demo's agent stands in for an app that has already been allowed:
    // the OAuth approval issues the same kind of key this does.
    key = await page.evaluate(async () => {
      const { csrf } = await fetch('/api/session').then((r) => r.json());
      const r = await fetch('/api/agent/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: '{}',
      });
      return (await r.json()).key;
    });
    if (!key) throw Error('No agent key was issued.');
  });

  await scene('Open Activity while the agent trades over MCP', async () => {
    await choose('Portfolio', 'Activity', '.od-nav-link');
    await beat();
    const agent = new Client({ name: 'parcel-demo-agent', version: '1.0.0' });
    await agent.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    const call = async (name, args = {}) => {
      const r = await agent.callTool({ name, arguments: args });
      const body = JSON.parse(r.content[0].text);
      if (r.isError) throw Error(`${name}: ${body.error}`);
      return body;
    };
    const market = await call('get_market');
    const expiry = market.expiries[2] ?? market.expiries[0];
    const spot = market.price;
    const strike = (x) => Math.round((spot * x) / 2.5) * 2.5;
    const trade = await call('trade_option', {
      terms: {
        symbol: 'NVDA',
        name: 'Agent call spread',
        quantity: 0.5,
        expiry,
        reference: 'stock',
        settlement: 'cash',
        legs: [
          { kind: 'call', side: 'buy', strike: strike(1.02), ratio: 1 },
          { kind: 'call', side: 'sell', strike: strike(1.08), ratio: 1 },
        ],
      },
      maxPremium: 10,
    });
    await agent.close();
    console.log(`    agent paid ${trade.premium.toFixed(4)} USDC over MCP`);
    // The open desk picks the agent's receipt up by itself.
    await expect(page.locator('.od-agent-tag').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.mouse.move(260, 225, { steps: pace ? 20 : 1 });
    await beat(3);
  });

  await scene('Back to holdings', async () => {
    await choose('Portfolio', 'Holdings', '.od-nav-link');
    await expect(page.getByText('Iron condor').first()).toBeVisible();
    await beat(2);
  });

  if (errors.length) throw Error(`Page errors:\n${errors.join('\n')}`);
  console.log('Demo complete: every step passed.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  await page
    .screenshot({ path: 'test-results/agent-demo-failure.png' })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  server?.kill();
}
