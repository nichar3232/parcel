import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_EQUITIES } from '../lib/parcel/public-equities';
import { INSTRUMENTS } from '../server/prices/feeds';

void test('public watchlist equities are unique, liquid and routed to exact Pyth feeds', () => {
  const symbols = new Set(PUBLIC_EQUITIES.map((equity) => equity.symbol));
  assert.equal(symbols.size, PUBLIC_EQUITIES.length);
  assert.deepEqual(
    [...symbols],
    ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA'],
  );
  for (const equity of PUBLIC_EQUITIES) {
    assert.equal(equity.pyth, `Equity.US.${equity.symbol}/USD`);
    assert.ok(equity.depth >= 20_000_000, `${equity.symbol} depth`);
    assert.ok(equity.vol > 0 && equity.vol < 1, `${equity.symbol} volatility`);
    const instrument = INSTRUMENTS.find(
      (item) => item.symbol === equity.symbol,
    );
    assert.deepEqual(instrument, { ...equity, kind: 'equity' });
  }
});
