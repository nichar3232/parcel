import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Store } from '../server/db/store';
import { VaultService, type VaultPlan } from '../server/parcel/service';
import { VaultChainCoordinator } from '../server/parcel/chain/coordinator';
import type {
  PreparedVaultTransaction,
  VaultChainAdapter,
} from '../server/parcel/chain/adapter';
import { chainGenesis } from '../server/parcel/ledger';
import { actionBytes, bookBytes, date } from '../server/parcel/chain/codec';
import { setLiveMarket, type LiveMarket } from '../lib/parcel/market';
import { borrowRate } from '../lib/parcel/lending';
import { fridayExpiries } from '../server/prices/live';
import type { VaultBook } from '../lib/parcel/types';
import { UNDERLYINGS } from '../lib/parcel/universe';

/**
 * A chain that holds what the program would: it takes each plan's book,
 * checks every action starts from the book it last confirmed, and keeps
 * the bytes it was handed. `PARCEL_CHAIN_FIXTURES=programs/parcel/fixtures`
 * writes them out as `before args after` hex lines, which the program's own
 * tests replay to prove it computes the same book the server projected.
 */
class LiveChain implements VaultChainAdapter {
  readonly network = 'devnet' as const;
  book = chainGenesis();
  revision = 0;
  records: { before: Buffer; args: Buffer; after: Buffer }[] = [];
  plans: VaultPlan[] = [];
  private plan!: VaultPlan;
  async prepare(
    _owner: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ): Promise<PreparedVaultTransaction | null> {
    if (stage === 'initialize') {
      // An existing ledger is verified and left; a new one must start
      // from the program's initial book, as the adapter checks.
      if (this.revision > 0) {
        await this.verify(_owner, plan.before, plan.revision);
        return null;
      }
      assert.equal(plan.revision, 0);
      assert.ok(bookBytes(plan.before).equals(bookBytes(chainGenesis())));
      return null;
    }
    assert.ok(bookBytes(plan.before).equals(bookBytes(this.book)));
    this.plan = plan;
    this.plans.push(plan);
    this.records.push({
      before: bookBytes(plan.before),
      args: actionBytes(plan),
      after: bookBytes(plan.book),
    });
    return {
      raw: 'raw',
      signature: `sig-${this.records.length}`,
      lastValidHeight: 1,
      ledger: 'live-ledger',
      stage,
    };
  }
  async broadcast() {
    this.book = this.plan.book;
    this.revision = this.plan.revision + 1;
  }
  async status() {
    return this.revision === this.plan.revision + 1
      ? ('confirmed' as const)
      : ('pending' as const);
  }
  async verify(_owner: string, b: VaultBook, revision: number) {
    assert.equal(revision, this.revision);
    assert.ok(bookBytes(b).equals(bookBytes(this.book)));
    return { ledger: 'live-ledger', slot: 1 };
  }
}

const ms = (iso: string) => Date.parse(iso);
function fixture(name: string, chain: LiveChain) {
  // Each action starts from the book the previous one left.
  for (let i = 1; i < chain.records.length; i++)
    assert.ok(chain.records[i].before.equals(chain.records[i - 1].after));
  const dir = process.env.PARCEL_CHAIN_FIXTURES;
  if (dir)
    writeFileSync(
      `${dir}/${name}`,
      chain.records
        .map((r) =>
          [r.before, r.args, r.after].map((b) => b.toString('hex')).join(' '),
        )
        .join('\n') + '\n',
    );
}
const le64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
};

void test('chain mode runs on the live market: every action carries its clock, and expiries settle at the recorded close', async () => {
  let clock = ms('2026-09-25T15:00:00.000Z'),
    spot = 178.19;
  const closes: Record<string, number> = {};
  const market: LiveMarket = {
    spot: (s) => (s === 'NVDA' ? spot : 100),
    close: (s, d) => closes[`${s}|${d}`] ?? null,
    expiries: (now) => fridayExpiries(now),
    quote: () => ({ bid: spot - 0.05, ask: spot + 0.05 }),
  };
  setLiveMarket(market);
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(
        store,
        () => clock,
        64,
        () => null,
        true,
      ),
      chain = new LiveChain(),
      c = new VaultChainCoordinator(store, vault, chain);
    // A new onchain session starts from the program's own initial book.
    let state = vault.snapshot(s);
    assert.equal(state.market.clock, 'live');
    assert.equal(state.market.price, 178.19);
    assert.equal(state.book.date, '2026-09-25T15:00:00.000Z');
    const act = async (action: Record<string, unknown>) =>
      (state = await c.apply(s, randomUUID(), {
        revision: state.revision,
        action,
      }));

    await act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'deposit',
      amount: 1000,
    });
    // The first action moves the ledger from the replay's first session to
    // now, at the live mark, and says so in its first argument.
    const first = chain.records[0];
    assert.equal(first.args[0], 1, 'Some(tick)');
    assert.ok(first.args.subarray(1, 9).equals(le64(clock)));
    assert.ok(first.args.subarray(1, 9).equals(date(state.book.date)));
    // One attested mark per stock, NVDA first.
    assert.equal(first.args.readUInt32LE(9), 9);
    assert.equal(first.args.readBigUInt64LE(13), 178_190_000n);
    assert.equal(first.args.readBigUInt64LE(21), 100_000_000n);
    assert.ok(first.before.subarray(0, 8).equals(le64(ms('2025-01-24'))));
    assert.equal(first.before.readBigUInt64LE(8), 142_620_000n);
    assert.ok(first.after.subarray(0, 8).equals(le64(clock)));
    assert.equal(state.book.spots!.NVDA, 178.19);
    assert.equal(state.book.spots!.OPENAI, 100);

    clock += 60_000;
    spot = 178.4;
    await act({
      type: 'transfer',
      asset: 'NVDA',
      direction: 'deposit',
      amount: 3,
    });
    // A live expiry is a Friday, not a replay session.
    const friday = '2026-10-02';
    assert.ok(state.market.dates.includes(friday));
    const { templateTerms } = await import('../lib/parcel/templates');
    const terms = templateTerms('call', friday);
    terms.quantity = 0.5;
    clock += 60_000;
    const quote = vault.quote(s, randomUUID(), {
      revision: state.revision,
      terms,
    });
    await act({ type: 'execute', quoteId: quote.id });
    assert.equal(state.book.options[0].terms.expiry, friday);
    await act({ type: 'stock', symbol: 'NVDA', side: 'buy', quantity: 1 });
    // A live stock order fills at the ask and the program is told so.
    assert.equal(chain.plans.at(-1)!.fill, 178.45);
    await act({ type: 'lend', symbol: 'NVDA', quantity: 1, expiry: friday });
    assert.equal(state.book.loans[0].productive!.cap, 267.6);
    await act({
      type: 'borrow',
      symbol: 'NVDA',
      pledged: 1,
      amount: 50,
      rate: 'variable',
    });
    // The pre-IPO sleeve trades in the same book, on its own marks.
    await act({
      type: 'transfer',
      asset: 'OPENAI',
      direction: 'deposit',
      amount: 2,
    });
    const openai = templateTerms('call', friday, 'OPENAI', 100);
    openai.quantity = 0.5;
    const openaiQuote = vault.quote(s, randomUUID(), {
      revision: state.revision,
      terms: openai,
    });
    await act({ type: 'execute', quoteId: openaiQuote.id });
    assert.equal(state.book.options[0].terms.symbol, 'OPENAI');
    await act({ type: 'lend', symbol: 'OPENAI', quantity: 1, expiry: friday });
    assert.equal(state.book.loans[0].symbol, 'OPENAI');
    assert.equal(state.risk.freeShares.OPENAI, 1);
    const stored = chain.records.length;

    // Friday's close is in. Reading the vault shows it settled, but nothing
    // is written until an action carries that clock to the program.
    clock = ms('2026-10-05T14:30:00.000Z');
    spot = 181.2;
    closes[`NVDA|${friday}`] = 185.5;
    closes[`OPENAI|${friday}`] = 104;
    state = vault.snapshot(s);
    assert.equal(state.book.options[0].status, 'settled');
    assert.equal(state.book.loans[0].status, 'closed');
    assert.equal(chain.records.length, stored);
    await act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'deposit',
      amount: 1,
    });
    const settled = chain.plans.at(-1)!;
    assert.deepEqual(settled.tick, {
      carry: true,
      closes: { [`${friday}|NVDA`]: 185.5, [`${friday}|OPENAI`]: 104 },
      apr: borrowRate('NVDA', null),
      date: '2026-10-05T14:30:00.000Z',
      spots: Object.fromEntries(
        UNDERLYINGS.map((u) => [u.symbol, u.symbol === 'NVDA' ? 181.2 : 100]),
      ),
    });
    assert.equal(settled.before.options[0].status, 'active');
    assert.equal(state.book.options[0].status, 'settled');
    assert.ok(state.book.borrows[0].accrued > 0);

    // Later the same day: no carry, no closes.
    clock += 3_600_000;
    await act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'withdraw',
      amount: 1,
    });
    assert.deepEqual(chain.plans.at(-1)!.tick!.closes, {});
    assert.equal(chain.plans.at(-1)!.tick!.carry, false);

    fixture('live-chain.hex', chain);
  } finally {
    setLiveMarket(null);
    store.close();
  }
});

void test('a replay book is never carried onto the live chain', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session;
    // Opened on the replay...
    new VaultService(store, Date.now, 64, () => null, true).snapshot(s);
    setLiveMarket({
      spot: () => 100,
      close: () => null,
      expiries: () => [],
    });
    // ...and read once the server runs live.
    assert.throws(
      () => new VaultService(store, Date.now, 64, () => null, true).snapshot(s),
      /opened on the 2025 replay/,
    );
  } finally {
    setLiveMarket(null);
    store.close();
  }
});

void test('the replay still runs on the chain: sessions advance at the committed closes', async () => {
  const store = new Store(':memory:');
  try {
    const s = store.createSession().session,
      vault = new VaultService(store, Date.now, 64, () => null, true),
      chain = new LiveChain(),
      c = new VaultChainCoordinator(store, vault, chain);
    let state = vault.snapshot(s);
    const act = async (action: Record<string, unknown>) =>
      (state = await c.apply(s, randomUUID(), {
        revision: state.revision,
        action,
      }));
    await act({
      type: 'transfer',
      asset: 'USDC',
      direction: 'deposit',
      amount: 1000,
    });
    await act({
      type: 'transfer',
      asset: 'NVDA',
      direction: 'deposit',
      amount: 4,
    });
    await act({ type: 'stock', symbol: 'NVDA', side: 'buy', quantity: 0.5 });
    await act({
      type: 'lend',
      symbol: 'NVDA',
      quantity: 1,
      expiry: '2025-02-07',
    });
    await act({
      type: 'short',
      symbol: 'NVDA',
      quantity: 0.5,
      cap: 160,
      expiry: '2025-02-07',
    });
    await act({
      type: 'borrow',
      symbol: 'NVDA',
      pledged: 1,
      amount: 50,
      rate: 'variable',
    });
    await act({
      type: 'borrow',
      symbol: 'NVDA',
      pledged: 1,
      amount: 40,
      rate: 'fixed',
      expiry: '2025-02-03',
    });
    const { templateTerms } = await import('../lib/parcel/templates');
    const terms = templateTerms('call', '2025-02-03');
    terms.quantity = 0.25;
    const quote = vault.quote(s, randomUUID(), {
      revision: state.revision,
      terms,
    });
    await act({ type: 'execute', quoteId: quote.id });
    await act({ type: 'advance', date: '2025-01-27T05:00:00Z' });
    await act({ type: 'advance', date: '2025-02-10' });
    assert.equal(state.book.options[0].status, 'settled');
    assert.equal(state.book.loans[0].status, 'closed');
    assert.equal(state.book.shorts[0].status, 'closed');
    assert.equal(state.book.borrows[0].status, 'closed');
    // No clock rides along on the replay; the program holds the table.
    for (const r of chain.records) assert.equal(r.args[0], 0);
    fixture('replay-chain.hex', chain);
  } finally {
    store.close();
  }
});
