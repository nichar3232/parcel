import assert from 'node:assert/strict';
import test from 'node:test';
import { OndoService } from '../server/tokenized-equities/ondo';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test('Ondo: stays explicitly unconfigured without a credential', async () => {
  let calls = 0;
  const service = new OndoService(
    async () => {
      calls++;
      return new Response('{}');
    },
    Date.now,
    'https://issuer.test',
    '',
  );
  assert.equal(service.configured, false);
  assert.deepEqual(await service.catalog(), []);
  assert.deepEqual(await service.quotes(['ondo:AAPLon']), []);
  assert.equal(calls, 0);
});

void test('Ondo: requires an issuer-declared Solana address and reads its direct price', async () => {
  let now = 1_800_000_000_000;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'test-key');
    if (url.pathname === '/v1/assets/all/metadata')
      return new Response(
        JSON.stringify([
          {
            symbol: 'AAPLon',
            ticker: 'AAPL',
            displayName: 'Apple (Ondo Tokenized)',
            tags: { assetClass: 'Equities', instrumentType: 'Stock' },
            addresses: [
              { networkChainId: 'ethereum-1', address: '0xapple' },
              { networkChainId: 'solana-mainnet', address: 'AppleMint' },
            ],
          },
          {
            symbol: 'MSFTon',
            ticker: 'MSFT',
            tags: { assetClass: 'Equities', instrumentType: 'Stock' },
            addresses: [
              { networkChainId: 'ethereum-1', address: '0xmicrosoft' },
            ],
          },
        ]),
        { status: 200 },
      );
    if (url.pathname === '/v1/assets/all/prices/latest')
      return new Response(
        JSON.stringify([
          {
            primaryMarket: { symbol: 'AAPLon', price: '171.383708297189' },
            timestamp: 1_799_999_999_000,
          },
        ]),
        { status: 200 },
      );
    return new Response('{}', { status: 404 });
  };
  const service = new OndoService(
    request,
    () => now,
    'https://issuer.test',
    'test-key',
  );
  assert.deepEqual(await service.catalog(), [
    {
      id: 'ondo:AAPLon',
      provider: 'ondo',
      providerName: 'Ondo Stocks',
      symbol: 'AAPLon',
      name: 'Apple (Ondo Tokenized)',
      underlyingSymbol: 'AAPL',
      underlyingType: 'Equity',
      logo: null,
      description: null,
      mint: 'AppleMint',
      isTradingHalted: false,
      marketOpen: null,
      nextChangeAt: null,
    },
  ]);
  assert.equal((await service.quotes(['ondo:AAPLon']))[0]?.state, 'pending');
  await tick();
  await tick();
  assert.deepEqual(await service.quotes(['ondo:AAPLon']), [
    {
      id: 'ondo:AAPLon',
      quote: 171.383708297189,
      observedAt: 1_799_999_999_000,
      receivedAt: 1_800_000_000_000,
      state: 'live',
      provider: 'ondo',
    },
  ]);
  now += 5_000;
});
