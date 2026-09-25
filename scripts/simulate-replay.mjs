// Precommitted replay paths for the pre-IPO tokens.
//
// The desk settles on stored daily closes. NVDA has real ones; a
// private company's token has a live mark and nothing behind it, so
// the replay needs a path that is fixed in advance the same way. This
// writes one per token: a geometric random walk over the same session
// calendar as the NVDA file, seeded by the symbol so it is
// reproducible, and scaled so the first session in the replay window
// opens at the provider's mark on the day the path was struck.
//
// Every file says it is simulated. Nothing here is a price the market
// ever printed; it is a fixed sequence the sandbox agrees to settle on.
//
//   node scripts/simulate-replay.mjs            # strike from live feeds
//   node scripts/simulate-replay.mjs --offline  # strike from the table below
import fs from 'node:fs';
import crypto from 'node:crypto';

const WINDOW_OPENS = '2025-01-24';
const VOL = 0.9; // annualised, the engine's own figure for a private mark

const nvda = JSON.parse(
  fs.readFileSync(new URL('../data/history.json', import.meta.url), 'utf8'),
);
const dates = nvda.rows.map((r) => r.date);

// The registry's symbols, and where each one's mark comes from. The
// anchors are the marks the feeds published when this table was last
// refreshed, used only when a feed cannot be reached.
const TOKENS = [
  {
    symbol: 'OPENAI',
    name: 'OpenAI',
    provider: 'prestocks',
    key: 'OPENAI',
    anchor: 970.19,
  },
  {
    symbol: 'ANTHROPIC',
    name: 'Anthropic',
    provider: 'prestocks',
    key: 'ANTHROPIC',
    anchor: 1016.47,
  },
  {
    symbol: 'SPACEX',
    name: 'SpaceX',
    provider: 'prestocks',
    key: 'SPACEX',
    anchor: 154.99,
  },
  {
    symbol: 'ANDURIL',
    name: 'Anduril',
    provider: 'prestocks',
    key: 'ANDURIL',
    anchor: 152.34,
  },
  {
    symbol: 'NEURALINK',
    name: 'Neuralink',
    provider: 'prestocks',
    key: 'NEURALINK',
    anchor: 320.91,
  },
  {
    symbol: 'FIGUREAI',
    name: 'Figure AI',
    provider: 'prestocks',
    key: 'FIGUREAI',
    anchor: 179.6,
  },
  {
    symbol: 'KALSHI',
    name: 'Kalshi',
    provider: 'prestocks',
    key: 'KALSHI',
    anchor: 877.74,
  },
  {
    symbol: 'POLYMARKET',
    name: 'Polymarket',
    provider: 'prestocks',
    key: 'POLYMARKET',
    anchor: 144.51,
  },
];

const PRESTOCKS_FEED = 'https://prestocks.com/api/prestocks';

async function liveMarks() {
  const marks = {};
  try {
    const res = await fetch(PRESTOCKS_FEED, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Error(`${res.status}`);
    const body = await res.json();
    for (const row of body)
      if (typeof row.markPrice === 'number' && typeof row.symbol === 'string')
        marks[row.symbol] = {
          price: row.markPrice,
          provider: 'prestocks',
          url: PRESTOCKS_FEED,
        };
  } catch (e) {
    console.warn(`PreStocks: ${e.message}; using the table's anchor`);
  }
  return marks;
}

/** Deterministic uniform generator from a symbol. */
function rng(seed) {
  let a = Number(
    '0x' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8),
  );
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (u) => {
  const a = Math.max(u(), 1e-12),
    b = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
};

function path(symbol, anchor) {
  const u = rng(`parcel-replay:${symbol}`);
  const dt = 1 / 252;
  let level = 1;
  const raw = dates.map(() => {
    level *= Math.exp(
      -0.5 * VOL * VOL * dt + VOL * Math.sqrt(dt) * gaussian(u),
    );
    return level;
  });
  const at = dates.indexOf(WINDOW_OPENS);
  const scale = anchor / raw[at];
  return dates.map((date, i) => {
    const close = +(raw[i] * scale).toFixed(2);
    const open = i ? +(raw[i - 1] * scale).toFixed(2) : close;
    const wiggle = Math.abs(gaussian(u)) * VOL * Math.sqrt(dt) * close * 0.5;
    return {
      date,
      open,
      high: +Math.max(open, close, close + wiggle).toFixed(2),
      low: +Math.min(open, close, close - wiggle).toFixed(2),
      close,
      volume: 0,
    };
  });
}

const offline = process.argv.includes('--offline');
const live = offline ? {} : await liveMarks();
const dir = new URL('../data/replay/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const struck = new Date().toISOString();
const index = [];
for (const t of TOKENS) {
  const mark = live[t.key];
  const anchor = mark?.price ?? t.anchor;
  const rows = path(t.symbol, anchor);
  const file = `${t.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  const doc = {
    symbol: t.symbol,
    name: t.name,
    provider: t.provider,
    source: 'Simulated replay path',
    anchor: {
      price: anchor,
      provider: t.provider,
      url: FEEDS[t.provider],
      struckAt: mark ? struck : `table (feed unreachable at ${struck})`,
      session: WINDOW_OPENS,
    },
    seed: `parcel-replay:${t.symbol}`,
    volatility: VOL,
    priceType:
      'Simulated daily closes. A seeded geometric random walk, scaled so the first replay session opens at the sponsor mark above. Not a price any venue printed.',
    policy:
      'Simulated replay v1. All observations precommitted at generation; no live or intraday settlement claim.',
    rows,
  };
  fs.writeFileSync(new URL(file, dir), JSON.stringify(doc, null, 2));
  index.push({
    symbol: t.symbol,
    name: t.name,
    provider: t.provider,
    file,
    anchor,
  });
  console.log(
    `${t.symbol.padEnd(11)} ${String(anchor).padStart(8)}  ${mark ? 'live' : 'table'}  -> data/replay/${file}`,
  );
}
fs.writeFileSync(
  new URL('index.json', dir),
  JSON.stringify({ struckAt: struck, tokens: index }, null, 2),
);
