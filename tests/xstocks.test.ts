import assert from 'node:assert/strict';
import test from 'node:test';
import { XStocksService } from '../server/xstocks/service';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  let now = 1_800_000_000_000;
  const calls: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/public/assets')) {
      const page = url.searchParams.get('page');
      return new Response(
        JSON.stringify(
          page === '0'
            ? {
                nodes: [
                  {
                    symbol: 'NVDAx',
                    name: 'NVIDIA xStock',
                    underlyingSymbol: 'NVDA',
                    underlying: { type: 'Equity' },
                    logo: 'https://issuer.test/nvdax.png',
                    isTradingHalted: false,
                    trading: { openNow: true },
                    deployments: [
                      { network: 'Ethereum', address: '0xnot-solana' },
                      { network: 'Solana', address: 'NVDAMint' },
                    ],
                  },
                  {
                    // Bad records cannot leak into a catalog that later maps
                    // symbols to mints and price requests.
                    symbol: 'BADx',
                    name: 'Malformed xStock',
                    underlyingSymbol: 'BAD',
                    deployments: [{ network: 'Solana' }],
                  },
                ],
                page: { hasNextPage: true },
              }
            : {
                nodes: [
                  {
                    symbol: 'SPYx',
                    name: 'SPDR S&P 500 xStock',
                    underlyingSymbol: 'SPY',
                    underlying: { type: 'ETF' },
                    isTradingHalted: true,
                    trading: {
                      openNow: false,
                      nextChangeAt: '2026-09-21T00:00:00.000Z',
                    },
                    deployments: [{ network: 'Solana', address: 'SPYMint' }],
                  },
                ],
                page: { hasNextPage: false },
              },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.pathname.endsWith('/NVDAx/price-data'))
      return new Response(JSON.stringify({ quote: 183.45 }), { status: 200 });
    if (url.pathname.endsWith('/SPYx/price-data'))
      return new Response(JSON.stringify({ quote: null }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return {
    service: new XStocksService(
      request,
      () => now,
      'https://issuer.test/api/v2',
    ),
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

void test('xStocks: paginates the current Solana issuer catalog and retains only usable mints', async () => {
  const { service, calls } = fixture();
  const catalog = await service.catalog();
  assert.deepEqual(catalog.assets, [
    {
      symbol: 'NVDAx',
      name: 'NVIDIA xStock',
      underlyingSymbol: 'NVDA',
      underlyingType: 'Equity',
      logo: 'https://issuer.test/nvdax.png',
      description: null,
      mint: 'NVDAMint',
      isTradingHalted: false,
      marketOpen: true,
      nextChangeAt: null,
    },
    {
      symbol: 'SPYx',
      name: 'SPDR S&P 500 xStock',
      underlyingSymbol: 'SPY',
      underlyingType: 'ETF',
      logo: null,
      description: null,
      mint: 'SPYMint',
      isTradingHalted: true,
      marketOpen: false,
      nextChangeAt: '2026-09-21T00:00:00.000Z',
    },
  ]);
  assert.ok(
    calls.includes('/api/v2/public/assets?network=Solana&page=0&pageSize=100'),
  );
  assert.ok(
    calls.includes('/api/v2/public/assets?network=Solana&page=1&pageSize=100'),
  );
});

void test('xStocks: prices only requested known symbols and never models a missing issuer quote', async () => {
  const { service, calls, advance } = fixture();
  const first = await service.quotes(['NVDAx', 'SPYx', 'NOTx']);
  assert.deepEqual(first, [
    {
      symbol: 'NVDAx',
      quote: null,
      observedAt: null,
      state: 'pending',
      source: 'xstocks',
    },
    {
      symbol: 'SPYx',
      quote: null,
      observedAt: null,
      state: 'pending',
      source: 'xstocks',
    },
  ]);
  await tick();
  await tick();
  const current = await service.quotes(['NVDAx', 'SPYx']);
  assert.deepEqual(current, [
    {
      symbol: 'NVDAx',
      quote: 183.45,
      observedAt: 1_800_000_000_000,
      state: 'live',
      source: 'xstocks',
    },
    {
      symbol: 'SPYx',
      quote: null,
      observedAt: 1_800_000_000_000,
      state: 'unavailable',
      source: 'xstocks',
    },
  ]);
  assert.equal(calls.filter((call) => call.endsWith('/price-data')).length, 2);

  // Fresh values read from cache; the no-quote state is not replaced with a
  // seed, prior close, or synthetic walk.
  await service.quotes(['NVDAx', 'SPYx']);
  assert.equal(calls.filter((call) => call.endsWith('/price-data')).length, 2);
  advance(10_000);
  await service.quotes(['NVDAx']);
  await tick();
  assert.equal(
    calls.filter((call) => call.endsWith('/NVDAx/price-data')).length,
    2,
  );
});
