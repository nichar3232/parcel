import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addOrder,
  initialVault,
  migrate,
  openLoan,
  openShort,
  premium,
  setMarketDate,
  totals,
  transfer,
  validateLedger,
} from '../server/parcel/ledger';
import { historyOf, mark, marketRows } from '../lib/parcel/market';
import { risk } from '../lib/parcel/risk';
import { parseOrderTerms } from '../lib/parcel/validation';
import { UNDERLYINGS, underlying } from '../lib/parcel/universe';
import { valueChartDomain, valueSeries } from '../lib/parcel/value';
import type { OrderTerms, VaultBook } from '../lib/parcel/types';

void test('every underlying shares one session calendar', () => {
  const dates = marketRows.map((r) => r.date);
  for (const u of UNDERLYINGS)
    assert.deepEqual(
      historyOf(u.symbol).map((r) => r.date),
      dates,
      `${u.symbol} sessions`,
    );
});

void test('vault chart domains do not magnify sub-basis-point mark noise', () => {
  const domain = valueChartDomain([
    { value: 13_279.02 },
    { value: 13_279.86 },
  ]);
  // At least 25 bp, plus a small visual cushion: pennies stay visible in the
  // number but do not consume an entire 200px chart.
  assert.ok(domain.hi - domain.lo > 13_279.44 * 0.0025 * 1.19);
  assert.ok(domain.lo < 13_279.02);
  assert.ok(domain.hi > 13_279.86);
});

void test('a simulated path opens at the mark it was struck from', () => {
  for (const u of UNDERLYINGS.filter((u) => u.simulated)) {
    assert.ok(u.anchor && u.anchor > 0, `${u.symbol} anchor`);
    // Two decimals in the file; the anchor carries the sponsor's full
    // precision.
    assert.ok(
      Math.abs(mark(u.symbol, '2025-01-24') - u.anchor) < 0.01,
      `${u.symbol} opens at its anchor`,
    );
  }
  assert.equal(underlying('NVDA').simulated, false);
  assert.equal(mark('NVDA', '2025-01-24'), 142.62);
  assert.throws(() => mark('DOGE', '2025-01-24'), /supported underlying/);
});

void test('a call on a token settles on that token, not on NVDA', () => {
  const b = initialVault();
  const original = totals(b);
  transfer(b.wallet, b.vault, 'USDC', 10_000);
  transfer(b.wallet, b.vault, 'ANTHROPIC', 2);
  const spot = mark('ANTHROPIC', b.date);
  const strike = Math.round((spot * 0.9) / 5) * 5;
  const terms = parseOrderTerms(
    {
      symbol: 'ANTHROPIC',
      name: 'covered call',
      quantity: 1,
      expiry: '2025-02-07',
      settlement: 'physical',
      reference: 'stock',
      legs: [{ kind: 'call', side: 'sell', strike, ratio: 1 }],
    },
    b.date,
  );
  const cost = premium(terms, b);
  assert.ok(cost < 0, 'writing a call is paid');
  addOrder(b, terms, cost);
  // The written call reserves one ANTHROPIC, and nothing of NVDA.
  const r = risk(b);
  assert.equal(r.shares.ANTHROPIC, 1);
  assert.equal(r.shares.NVDA, 0);
  assert.equal(r.freeShares.ANTHROPIC, 1);

  setMarketDate(b, '2025-02-07');
  const close = mark('ANTHROPIC', '2025-02-07');
  const p = b.options[0];
  assert.equal(p.status, 'settled');
  if (close > strike) {
    assert.equal(p.stockFlow, -1);
    assert.equal(b.vault.ANTHROPIC, 1);
    assert.equal(b.vault.USDC, 10_000 - cost + strike);
  } else {
    assert.equal(p.stockFlow, 0);
    assert.equal(b.vault.ANTHROPIC, 2);
  }
  assert.equal(b.vault.NVDA, 0);
  validateLedger(b, original);
});

void test('loans and shorts carry their symbol through open and close', () => {
  const b = initialVault();
  const original = totals(b);
  transfer(b.wallet, b.vault, 'USDC', 10_000);
  transfer(b.wallet, b.vault, 'OPENAI', 3);
  openLoan(b, 1, '2025-02-07', 'OPENAI');
  assert.equal(b.loans[0].symbol, 'OPENAI');
  assert.equal(b.vault.OPENAI, 2);
  const cap = Math.ceil(mark('OPENAI', b.date) * 1.2);
  openShort(b, 1, cap, '2025-02-07', 'OPENAI');
  assert.equal(b.shorts[0].symbol, 'OPENAI');
  assert.equal(risk(b).counterpartyShares.OPENAI, 1);
  assert.equal(risk(b).counterpartyShares.NVDA, 0);
  setMarketDate(b, '2025-02-07');
  assert.equal(b.loans[0].status, 'closed');
  assert.equal(b.shorts[0].status, 'closed');
  assert.equal(b.vault.OPENAI, 3);
  validateLedger(b, original);
  // Every event on this book names the token it moved.
  assert.ok(
    b.events.filter((e) => e.shares !== 0).every((e) => e.symbol === 'OPENAI'),
  );
});

void test('dividend contracts stay on NVDA', () => {
  const b = initialVault();
  assert.throws(
    () =>
      parseOrderTerms(
        {
          symbol: 'ANTHROPIC',
          name: 'dividend',
          quantity: 1,
          expiry: '2025-03-12',
          settlement: 'cash',
          reference: 'dividend',
          legs: [{ kind: 'put', side: 'buy', strike: 0.005, ratio: 1 }],
        },
        b.date,
      ),
    /NVDA only/,
  );
});

void test('a version 2 book migrates to NVDA and gains the new symbols', () => {
  const old = {
    version: 2,
    date: '2025-01-24',
    margin: 'cross',
    wallet: { USDC: 9000, NVDA: 24 },
    vault: { USDC: 1000, NVDA: 1 },
    counterparty: { USDC: 2000000, NVDA: 10000 },
    market: { USDC: 2000000, NVDA: 10000 },
    options: [
      {
        id: 'a',
        terms: {
          name: 'call',
          quantity: 1,
          expiry: '2025-02-07',
          settlement: 'physical',
          reference: 'stock',
          legs: [{ kind: 'call', side: 'buy', strike: 145, ratio: 1 }],
        } as OrderTerms,
        premium: 4,
        opened: '2025-01-24',
        status: 'active',
      },
    ],
    loans: [],
    shorts: [],
    borrows: [],
    events: [
      {
        id: 'e',
        date: '2025-01-24',
        timestamp: 0,
        title: 'Vault deposit',
        detail: '',
        cash: 1000,
        shares: 1,
      },
    ],
  } as unknown as VaultBook & { version: number };
  const book = migrate(old);
  assert.equal(book.version, 3);
  assert.equal(book.options[0].terms.symbol, 'NVDA');
  assert.equal(book.events[0].symbol, 'NVDA');
  assert.equal(book.vault.NVDA, 1);
  assert.equal(book.vault.ANTHROPIC, 0);
  assert.equal(book.wallet.ANTHROPIC, initialVault().wallet.ANTHROPIC);
  assert.equal(book.counterparty.ANTHROPIC, 10000);
  // The migrated book conserves against a fresh one plus what it held.
  const fresh = totals(initialVault());
  const mine = totals(book);
  assert.equal(mine.shares.ANTHROPIC, fresh.shares.ANTHROPIC);
  assert.equal(mine.shares.NVDA, fresh.shares.NVDA);
  // And it values on the right path.
  const series = valueSeries(book);
  const opened = series.find((p) => p.date === '2025-01-24' && !p.backfill)!;
  assert.equal(opened.value, 1000 + 1 * mark('NVDA', '2025-01-24'));
  // Days before the first deposit carry the opening holdings at their
  // own closes, marked as backfill.
  assert.ok(series[0].backfill && series[0].date < '2025-01-24');
});

// Bounty rule: a project that integrates any pre-IPO token not issued by
// PreStocks is ineligible. Every non-listed underlying must be PreStocks.
void test('every pre-IPO underlying is a PreStocks token', () => {
  const preIpo = UNDERLYINGS.filter((u) => u.provider !== 'equity');
  assert.ok(preIpo.length > 0);
  for (const u of preIpo) assert.equal(u.provider, 'prestocks', u.symbol);
});

void test('a pre-IPO symbol ending in X is not mistaken for an xStock', async () => {
  const { categoryOf } = await import('../lib/parcel/lending');
  assert.equal(categoryOf('SPACEX'), 'preipo');
  assert.equal(categoryOf('NVDAx'), 'xstocks');
});
