import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TokenizedEquitiesService } from '../server/tokenized-equities/service';
import type {
  TokenizedEquityAsset,
  TokenizedEquityQuote,
} from '../server/tokenized-equities/types';
import type { XStocksService } from '../server/xstocks/service';
import type { OndoService } from '../server/tokenized-equities/ondo';
import type { SuperstateService } from '../server/tokenized-equities/superstate';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

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
    quotesForVerifiedSymbols: async () => [
      {
        symbol: 'NVDAx',
        quote: 183.45,
        observedAt: 100,
        receivedAt: 100,
        state: 'live' as const,
        source: 'xstocks' as const,
      },
    ],
  } as unknown as XStocksService;
  const superstate = {
    catalog: async () => [openingBell],
    quotesForVerifiedAssets: async (): Promise<TokenizedEquityQuote[]> => [
      {
        id: 'superstate:FWDI',
        quote: 7.69499,
        observedAt: 200,
        receivedAt: 200,
        state: 'live',
        provider: 'superstate',
      },
    ],
  } as unknown as SuperstateService;
  const ondo = {
    configured: false,
    catalog: async () => [],
    quotesForVerifiedAssets: async () => [],
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
        receivedAt: 100,
        state: 'live',
        provider: 'xstocks',
      },
      {
        id: 'superstate:FWDI',
        quote: 7.69499,
        observedAt: 200,
        receivedAt: 200,
        state: 'live',
        provider: 'superstate',
      },
    ],
  );
});

void test('tokenized equities: the browser snapshot is immediate and shares one cold refresh', async () => {
  let xstocksCatalogCalls = 0;
  const xstocks = {
    catalog: async () => {
      xstocksCatalogCalls++;
      return {
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
      };
    },
    quotes: async () => [],
  } as unknown as XStocksService;
  const superstate = {
    catalog: async () => [openingBell],
    quotes: async () => [],
  } as unknown as SuperstateService;
  const ondo = {
    configured: false,
    catalog: async () => [],
    quotes: async () => [],
  } as unknown as OndoService;
  const service = new TokenizedEquitiesService(xstocks, superstate, ondo);

  assert.deepEqual(
    service.snapshot().sources.map((source) => source.state),
    ['pending', 'pending', 'not-configured'],
  );
  service.snapshot();
  assert.equal(xstocksCatalogCalls, 1);

  await tick();
  await tick();
  assert.deepEqual(
    service.snapshot().assets.map((asset) => asset.id),
    ['superstate:FWDI', 'xstocks:NVDAx'],
  );
});

void test('tokenized equities: an unavailable issuer retries promptly without blocking the browser', async () => {
  let now = 1_800_000_000_000;
  let xstocksUp = false;
  const xstocks = {
    catalog: async () => {
      if (!xstocksUp) throw Error('issuer timeout');
      return {
        source: 'xstocks' as const,
        refreshedAt: now,
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
      };
    },
    quotes: async () => [],
  } as unknown as XStocksService;
  const superstate = {
    catalog: async () => [openingBell],
    quotes: async () => [],
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
    () => now,
  );

  assert.equal(
    (await service.catalog()).sources.find((source) => source.id === 'xstocks')
      ?.state,
    'unavailable',
  );
  xstocksUp = true;
  now += 30_001;
  assert.equal(
    service.snapshot().sources.find((source) => source.id === 'xstocks')?.state,
    'unavailable',
  );
  await tick();
  await tick();
  assert.equal(
    service.snapshot().sources.find((source) => source.id === 'xstocks')?.state,
    'live',
  );
});

void test('tokenized equities: a persisted issuer catalog is shown as cached on restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'parcel-tokenized-'));
  const cacheFile = path.join(directory, 'catalog.json');
  try {
    await writeFile(
      cacheFile,
      JSON.stringify({
        assets: [openingBell],
        sources: [
          {
            id: 'xstocks',
            name: 'xStocks',
            state: 'live',
            assets: 0,
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
        ],
        refreshedAt: 10,
      }),
    );
    const service = new TokenizedEquitiesService(
      {} as XStocksService,
      {} as SuperstateService,
      { configured: false } as OndoService,
      () => 11,
      { cacheFile },
    );
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.assets, [openingBell]);
    assert.deepEqual(
      snapshot.sources.map((source) => source.state),
      ['cached', 'cached', 'not-configured'],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
