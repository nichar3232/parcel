import assert from 'node:assert/strict';
import test from 'node:test';
import { SuperstateService } from '../server/tokenized-equities/superstate';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  let now = 1_800_000_000_000;
  const calls: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.pathname);
    if (url.pathname === '/v1/assets')
      return new Response(
        JSON.stringify({
          FWDI: {
            instrument_symbol: 'FWDI',
            instrument_domain: 'Equities',
            instrument_name: 'Forward Industries',
            nickname: 'Forward Industries',
            logo: 'https://issuer.test/fwdi.png',
            deploy_status_by_chain: {
              by_chain: {
                '900': { type: 'Completed', token_address: 'FWDIMint' },
                '1': { type: 'Completed', token_address: '0xFWDI' },
              },
            },
          },
          PENDING: {
            instrument_symbol: 'PENDING',
            instrument_domain: 'Equities',
            deploy_status_by_chain: {
              by_chain: {
                '900': { type: 'Pending', token_address: 'PendingMint' },
              },
            },
          },
          EVMONLY: {
            instrument_symbol: 'EVMONLY',
            instrument_domain: 'Equities',
            deploy_status_by_chain: {
              by_chain: { '1': { type: 'Completed', token_address: '0x1' } },
            },
          },
          USTB: {
            instrument_symbol: 'USTB',
            instrument_domain: 'Funds',
            deploy_status_by_chain: {
              by_chain: {
                '900': { type: 'Completed', token_address: 'USTBMint' },
              },
            },
          },
        }),
        { status: 200 },
      );
    if (url.pathname === '/v1/price/FWDI')
      return new Response(
        JSON.stringify({
          base_symbol: 'FWDI',
          quote_symbol: 'USD',
          price: '7.694990',
          timestamp: '2026-09-21T00:00:00.000Z',
        }),
        { status: 200 },
      );
    return new Response('{}', { status: 404 });
  };
  return {
    service: new SuperstateService(request, () => now, 'https://issuer.test'),
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

void test('Opening Bell: retains only completed Solana equity deployments', async () => {
  const { service } = fixture();
  assert.deepEqual(await service.catalog(), [
    {
      id: 'superstate:FWDI',
      provider: 'superstate',
      providerName: 'Opening Bell',
      symbol: 'FWDI',
      name: 'Forward Industries',
      underlyingSymbol: 'FWDI',
      underlyingType: 'Equity',
      logo: 'https://issuer.test/fwdi.png',
      description: null,
      mint: 'FWDIMint',
      isTradingHalted: false,
      marketOpen: null,
      nextChangeAt: null,
    },
  ]);
});

void test('Opening Bell: serves only direct issuer prices and preserves unavailable state', async () => {
  const { service, calls, advance } = fixture();
  assert.deepEqual(
    await service.quotes(['superstate:FWDI', 'superstate:NOPE']),
    [
      {
        id: 'superstate:FWDI',
        quote: null,
        observedAt: null,
        state: 'pending',
        provider: 'superstate',
      },
    ],
  );
  await tick();
  await tick();
  assert.deepEqual(await service.quotes(['superstate:FWDI']), [
    {
      id: 'superstate:FWDI',
      quote: 7.69499,
      observedAt: Date.parse('2026-09-21T00:00:00.000Z'),
      state: 'live',
      provider: 'superstate',
    },
  ]);
  await service.quotes(['superstate:FWDI']);
  assert.equal(calls.filter((path) => path === '/v1/price/FWDI').length, 1);
  advance(5_000);
  await service.quotes(['superstate:FWDI']);
  await tick();
  assert.equal(calls.filter((path) => path === '/v1/price/FWDI').length, 2);
});
