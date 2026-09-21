import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenizedEquitiesService } from '../server/tokenized-equities/service';
import type {
  TokenizedEquityAsset,
  TokenizedEquityQuote,
} from '../server/tokenized-equities/types';
import type { XStocksService } from '../server/xstocks/service';
import type { OndoService } from '../server/tokenized-equities/ondo';
import type { SuperstateService } from '../server/tokenized-equities/superstate';

const openingBell: TokenizedEquityAsset = {
  id: 'superstate:FWDI',
  provider: 'superstate',
  providerName: 'Opening Bell',
  symbol: 'FWDI',
  name: 'Forward Industries',
  underlyingSymbol: 'FWDI',
  underlyingType: 'Equity',
  logo: null,
  description: null,
  mint: 'FWDIMint',
  isTradingHalted: false,
  marketOpen: null,
  nextChangeAt: null,
};

void test('tokenized equities: keeps issuer identity through an aggregated catalog and quote request', async () => {
  const xstocks = {
    catalog: async () => ({
      source: 'xstocks' as const,
      refreshedAt: 10,
      assets: [
        {
          symbol: 'NVDAx',
          name: 'NVIDIA xStock',
          underlyingSymbol: 'NVDA',
          underlyingType: 'Equity' as const,
          logo: null,
          description: null,
          mint: 'NVDAMint',
          isTradingHalted: false,
          marketOpen: true,
          nextChangeAt: null,
        },
      ],
    }),
    quotes: async () => [
      {
        symbol: 'NVDAx',
        quote: 183.45,
        observedAt: 100,
        state: 'live' as const,
        source: 'xstocks' as const,
      },
    ],
  } as unknown as XStocksService;
  const superstate = {
    catalog: async () => [openingBell],
    quotes: async (): Promise<TokenizedEquityQuote[]> => [
      {
        id: 'superstate:FWDI',
        quote: 7.69499,
        observedAt: 200,
        state: 'live',
        provider: 'superstate',
      },
    ],
  } as unknown as SuperstateService;
  const ondo = {
    configured: false,
    catalog: async () => [],
    quotes: async () => [],
  } as unknown as OndoService;
  const service = new TokenizedEquitiesService(
    xstocks,
    superstate,
    ondo,
    () => 1_800_000_000_000,
  );

  const catalog = await service.catalog();
  assert.deepEqual(catalog.sources, [
    {
      id: 'xstocks',
      name: 'xStocks',
      state: 'live',
      assets: 1,
      detail: 'Public issuer registry',
    },
    {
      id: 'superstate',
      name: 'Opening Bell',
      state: 'live',
      assets: 1,
      detail: 'Public issuer registry',
    },
    {
      id: 'ondo',
      name: 'Ondo Stocks',
      state: 'not-configured',
      assets: 0,
      detail: 'Issuer API key required',
    },
  ]);
  assert.deepEqual(
    catalog.assets.map(({ id, provider, mint }) => ({ id, provider, mint })),
    [
      { id: 'superstate:FWDI', provider: 'superstate', mint: 'FWDIMint' },
      { id: 'xstocks:NVDAx', provider: 'xstocks', mint: 'NVDAMint' },
    ],
  );
  assert.deepEqual(
    await service.quotes(['xstocks:NVDAx', 'superstate:FWDI', 'unknown:AAPL']),
    [
      {
        id: 'xstocks:NVDAx',
        quote: 183.45,
        observedAt: 100,
        state: 'live',
        provider: 'xstocks',
      },
      {
        id: 'superstate:FWDI',
        quote: 7.69499,
        observedAt: 200,
        state: 'live',
        provider: 'superstate',
      },
    ],
  );
});
