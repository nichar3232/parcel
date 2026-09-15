import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store';
import { VaultService } from '../server/oddlot/service';
import { templateTerms } from '../lib/oddlot/templates';
import { risk } from '../lib/oddlot/risk';
import { initialVault } from '../server/oddlot/ledger';
import { parseOrderTerms } from '../lib/oddlot/validation';
import { strategyPnl } from '../lib/oddlot/math';
void test('quote: an unfunded physical call still reports all exercise collateral', () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      v = new VaultService(store);
    const q = v.quote(s, randomUUID(), {
      revision: 0,
      terms: templateTerms('call', '2025-02-07'),
    });
    assert.equal(q.eligible, false);
    assert.equal(q.cashRequired, 145);
    assert.ok(q.cashAfter < -145);
    assert.equal(v.snapshot(s).book.vault.USDC, 0);
  } finally {
    store.close();
  }
});
void test('zero payable contracts are rejected before any premium or position can be recorded', () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      v = new VaultService(store);
    const t = templateTerms('call-spread', '2025-02-07');
    t.quantity = 0.000001;
    t.legs[1].strike = 140.000001;
    for (const invert of [false, true]) {
      if (invert)
        t.legs = t.legs.map((l) => ({
          ...l,
          side: l.side === 'buy' ? 'sell' : 'buy',
        }));
      assert.throws(
        () => v.quote(s, randomUUID(), { revision: 0, terms: t }),
        /no payable value/,
      );
    }
    t.quantity = 1;
    t.legs[1].strike = 140;
    assert.throws(
      () => v.quote(s, randomUUID(), { revision: 0, terms: t }),
      /no payable value/,
    );
    assert.equal(v.snapshot(s).revision, 0);
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM vault_quotes').get()!.n,
      0,
    );
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM receipts').get()!.n,
      0,
    );
  } finally {
    store.close();
  }
});
void test('precision validation rejects seven decimals before chart math', () => {
  const t = templateTerms('covered-call', '2025-02-07');
  t.quantity = 0.3333333;
  assert.throws(() => parseOrderTerms(t, '2025-01-24'), /six decimals/);
});
void test('covered-call total strategy includes the underlying stock loss', () => {
  const t = templateTerms('covered-call', '2025-02-07');
  assert.equal(strategyPnl(t, 100, 142.62, -2.33, 1), -40.29);
  assert.equal(strategyPnl(t, 100, 142.62, -2.33, 0), 2.33);
});
void test('closing uses a reviewed owner-bound quote and returns the exact signed cash amount', () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      v = new VaultService(store);
    v.apply(s, randomUUID(), {
      revision: 0,
      action: {
        type: 'transfer',
        asset: 'USDC',
        direction: 'deposit',
        amount: 1000,
      },
    });
    const q = v.quote(s, randomUUID(), {
      revision: 1,
      terms: templateTerms('call-spread', '2025-02-07'),
    });
    const opened = v.apply(s, randomUUID(), {
      revision: 1,
      action: { type: 'execute', quoteId: q.id },
    });
    assert.throws(
      () =>
        v.apply(s, randomUUID(), {
          revision: 2,
          action: { type: 'close-option', id: opened.book.options[0].id },
        }),
      /review a close quote/,
    );
    const c = v.quote(s, randomUUID(), {
      revision: 2,
      positionId: opened.book.options[0].id,
    });
    assert.equal(c.intent, 'close');
    assert.equal(c.premium, -q.premium);
    const closed = v.apply(s, randomUUID(), {
      revision: 2,
      action: { type: 'execute', quoteId: c.id },
    });
    assert.equal(closed.book.vault.USDC, 1000);
    assert.equal(closed.book.options[0].status, 'closed');
    assert.throws(
      () =>
        v.apply(s, randomUUID(), {
          revision: 3,
          action: { type: 'execute', quoteId: c.id },
        }),
      /already executed/,
    );
  } finally {
    store.close();
  }
});
void test('a completed historical replay restarts without reusing revision or deleting receipts', () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      v = new VaultService(store);
    v.apply(s, randomUUID(), {
      revision: 0,
      action: { type: 'advance', date: '2025-04-03' },
    });
    const key = randomUUID(),
      input = { revision: 1, action: { type: 'restart' } };
    const restarted = v.apply(s, key, input);
    assert.equal(restarted.revision, 2);
    assert.equal(restarted.book.date, '2025-01-24');
    assert.deepEqual(v.apply(s, key, input), restarted);
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM receipts').get()!.n,
      2,
    );
    assert.equal(
      v.quote(s, randomUUID(), {
        revision: 2,
        terms: templateTerms('covered-call', '2025-02-07'),
      }).terms.expiry,
      '2025-02-07',
    );
  } finally {
    store.close();
  }
});
void test('500-position risk calculation remains bounded after replacing quadratic sampling', () => {
  const b = initialVault();
  b.options = Array.from({ length: 500 }, (_, i) => {
    const terms = templateTerms('put-spread', '2025-02-07');
    terms.quantity = 0.333333;
    terms.legs = terms.legs.map((l) => ({
      ...l,
      strike: l.strike + i / 10000,
    }));
    return {
      id: String(i),
      terms,
      premium: 0,
      opened: b.date,
      status: 'active' as const,
    };
  });
  const start = performance.now();
  const result = risk(b);
  const elapsed = performance.now() - start;
  assert.ok(result.counterpartyCash > 0);
  // Generous CI bound; the previous per-price × per-position scan exceeded it.
  assert.ok(elapsed < 500, `500 positions took ${elapsed.toFixed(1)} ms`);
});

void test('productive lending sells the borrowed stock, reserves protection, and repurchases principal', async () => {
  const { openLoan, closeLoan, totals, validateLedger, transfer } =
    await import('../server/oddlot/ledger');
  const { mul, add } = await import('../lib/oddlot/math');
  const { mark } = await import('../lib/oddlot/market');
  const b = initialVault();
  transfer(b.wallet, b.vault, 'NVDA', 0.333333);
  const original = totals(b),
    marketCash = b.market.USDC;
  openLoan(b, 0.333333, '2025-02-07');
  const p = b.loans[0];
  assert.ok(p.productive);
  assert.equal(
    b.counterparty.NVDA,
    10000,
    'borrowed shares are sold, not earmarked at the borrower',
  );
  assert.equal(b.market.NVDA, 10000.333333);
  assert.equal(
    b.market.USDC,
    add(
      add(marketCash, -mul(p.quantity, p.productive.entry)),
      p.productive.premium,
    ),
  );
  assert.equal(risk(b).marketShares, p.quantity);
  validateLedger(b, original);
  b.date = '2025-01-27';
  closeLoan(b, p);
  assert.equal(b.vault.NVDA, p.quantity);
  assert.equal(
    b.market.USDC,
    add(
      add(
        add(marketCash, -mul(p.quantity, p.productive.entry)),
        p.productive.premium,
      ),
      mul(p.quantity, mark(b.date)),
    ),
  );
  assert.ok(b.vault.USDC > 0);
  assert.equal(risk(b).marketShares, 0);
  validateLedger(b, original);
});
void test('market shares pledged to loan protection cannot be sold again', async () => {
  const { openLoan, transfer } = await import('../server/oddlot/ledger');
  const { assertCollateral } = await import('../lib/oddlot/risk');
  const b = initialVault();
  transfer(b.wallet, b.vault, 'NVDA', 1);
  openLoan(b, 1, '2025-02-07');
  b.market.NVDA = 0.999999;
  assert.throws(
    () => assertCollateral(b),
    /market shares backing loan protection/,
  );
});

void test('the program commits exactly the same historical dates and prices as the backend', async () => {
  const { readFileSync } = await import('node:fs');
  const { clockRows: marketRows, DIVIDEND_DATE } =
    await import('../lib/oddlot/market');
  const source = readFileSync(
    new URL('../programs/oddlot/src/market.rs', import.meta.url),
    'utf8',
  );
  const values = (name: string) =>
    source
      .match(new RegExp(`${name}:.*?= &\\[([\\s\\S]*?)\\];`))![1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map(Number);
  assert.deepEqual(
    values('PRICES'),
    marketRows.map((r) => Math.round(r.close * 1e6)),
  );
  assert.deepEqual(
    values('HOURS'),
    marketRows.map(
      (r) => (Date.parse(r.date) - Date.parse(marketRows[0].date)) / 3600000,
    ),
  );
  assert.equal(
    Number(source.match(/DIVIDEND_DATE: u16 = (\d+)/)![1]),
    marketRows.findIndex((r) => r.date === DIVIDEND_DATE),
  );
});
