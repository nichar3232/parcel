import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchPreStocks,
  parsePreStocks,
} from '../lib/preipo/providers/prestocks';
import { loadAssets, resetAssetCache } from '../server/preipo/assets';
import { parseMintAccount } from '../lib/preipo/chain';
import { evaluateMint, netAfterFee, transferFee } from '../lib/preipo/policy';
import { registry, TOKEN_2022, byId } from '../lib/preipo/registry';
import { resolveAssets, escrowable } from '../lib/preipo/resolve';
import {
  displayStrike,
  parseUnits,
  summarise,
  validateTerms,
  TermsError,
  type CoveredCallTerms,
} from '../lib/preipo/terms';

const AT = '2026-09-20T00:00:00.000Z';

/** Captured from the publisher schema; every public field is retained. */
const PRESTOCKS_BODY = [
  {
    name: 'Anthropic PreStocks',
    symbol: 'ANTHROPIC',
    description: 'ANTHROPIC is a PreStocks issued token…',
    image: 'https://www.prestocks.com/logos/anthropic.png',
    external_url: 'https://www.prestocks.com/anthropic',
    contract_address: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    markPrice: 1007.05683324,
    markValuation: 1649903811610,
    tokenPrice: 956.7206391833798,
    impliedValuation: 1567435895506,
    supply: 7381.972255745,
  },
];

const mintAccount = (extensions: { extension: string; state?: unknown }[]) => ({
  owner: TOKEN_2022,
  data: {
    parsed: {
      type: 'mint',
      info: {
        decimals: 9,
        supply: '684825114702',
        mintAuthority: 'EXvTtxurWBUNNCtLojaN8ZBJFNJPZFSH3szoih9hh7YW',
        freezeAuthority: '7n2PNcDXVDMK2m8dyV9cVPNY7p4jM4ZMHv7TzfibEt8o',
        extensions,
      },
    },
  },
});

const PRESTOCKS_EXTS = [
  { extension: 'permanentDelegate' },
  { extension: 'defaultAccountState' },
  {
    extension: 'transferFeeConfig',
    state: {
      newerTransferFee: {
        epoch: 1032,
        maximumFee: '18446744073709551615',
        transferFeeBasisPoints: 50,
      },
    },
  },
  { extension: 'transferHook' },
  { extension: 'scaledUiAmountConfig' },
  { extension: 'pausableConfig' },
  { extension: 'metadataPointer' },
  { extension: 'tokenMetadata' },
];

// ----------------------------------------------------------- publisher API

void test('PreStocks parsing retains every publisher field the watchlist needs', () => {
  const [quote] = parsePreStocks(PRESTOCKS_BODY, AT);
  assert.equal(quote.provider, 'prestocks');
  assert.equal(quote.mint, 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw');
  assert.equal(quote.markPriceUsd, 1007.05683324);
  assert.equal(
    quote.meta.description,
    'ANTHROPIC is a PreStocks issued token…',
  );
  assert.equal(quote.meta.tokenPrice, 956.7206391833798);
  assert.equal(quote.meta.markValuation, 1649903811610);
  assert.equal(quote.meta.impliedValuation, 1567435895506);
  assert.equal(quote.meta.supplyTokens, 7381.972255745);
  assert.equal(
    quote.meta.image,
    'https://www.prestocks.com/logos/anthropic.png',
  );
  assert.equal(quote.meta.externalUrl, 'https://www.prestocks.com/anthropic');
});

void test('PreStocks rejects malformed publisher bodies', () => {
  assert.throws(() => parsePreStocks({ products: [] }, AT), /array/);
  assert.throws(
    () => parsePreStocks([{ ...PRESTOCKS_BODY[0], contract_address: '' }], AT),
    /contract_address/,
  );
});

// ------------------------------------------------------------- chain policy

void test('mint parsing preserves the network and unknown extensions', () => {
  const m = parseMintAccount(
    registry[0].mint,
    'mainnet',
    mintAccount([...PRESTOCKS_EXTS, { extension: 'someFutureThing' }]),
  );
  assert.ok(m);
  assert.equal(m.network, 'mainnet');
  assert.equal(m.decimals, 9);
  assert.equal(m.tokenProgram, TOKEN_2022);
  assert.equal(m.transferFeeBasisPoints, 50);
  assert.deepEqual(m.unknownExtensions, ['someFutureThing']);
});

void test('a non-mint account is not accepted as a mint', () => {
  assert.equal(
    parseMintAccount('x', 'mainnet', {
      owner: TOKEN_2022,
      data: { parsed: { type: 'account', info: {} } },
    }),
    null,
  );
  assert.equal(parseMintAccount('x', 'mainnet', null), null);
});

void test('PreStocks mint protections are read and block escrow', () => {
  const asset = byId('prestocks:anthropic')!;
  const m = parseMintAccount(
    asset.mint,
    'mainnet',
    mintAccount(PRESTOCKS_EXTS),
  )!;
  const { verdict } = evaluateMint(asset, m);
  assert.equal(verdict.escrowSupported, false);
  assert.deepEqual(verdict.blockers.map((b) => b.code).sort(), [
    'mutable-ui-multiplier',
    'pausable',
    'permanent-delegate',
    'transfer-hook',
  ]);
});

void test('a mint that drifts from the reviewed registry is rejected', () => {
  const asset = byId('prestocks:openai')!;
  const drifted = parseMintAccount(asset.mint, 'mainnet', {
    ...mintAccount(PRESTOCKS_EXTS),
    data: {
      parsed: {
        type: 'mint',
        info: { decimals: 6, supply: '1', extensions: PRESTOCKS_EXTS },
      },
    },
  })!;
  const { verdict, registryMismatch } = evaluateMint(asset, drifted);
  assert.equal(verdict.escrowSupported, false);
  assert.ok(registryMismatch.some((m) => m.includes('decimals')));
});

void test('an unreadable mint is never treated as supported', () => {
  assert.equal(evaluateMint(registry[0], null).verdict.escrowSupported, false);
});

// ---------------------------------------------------------- token math

void test('transfer fees round up and respect their cap', () => {
  assert.equal(transferFee(10_000n, 20, null), 20n);
  assert.equal(transferFee(1n, 20, null), 1n);
  assert.equal(transferFee(10_000n, 20, '5'), 5n);
  assert.equal(netAfterFee(10_000n, 20, null), 9_980n);
  assert.throws(() => transferFee(1n, 10_000, null), /below 10000/);
});

const baseTerms = (over: Partial<CoveredCallTerms> = {}): CoveredCallTerms => ({
  underlyingMint: registry[0].mint,
  usdcMint: 'EPjFWdd5AufqSSqeM2K1xzybapC8G4wEGGkZwyTDt1v',
  underlyingAmount: 250_000_000n,
  totalExercisePayment: 225_000_000n,
  totalPremium: 6_500_000n,
  acceptanceDeadline: 1_800_000_000,
  exerciseExpiry: 1_800_600_000,
  designatedBuyer: null,
  ...over,
});

void test('covered-call terms retain exact totals and precision', () => {
  assert.doesNotThrow(() => validateTerms(baseTerms()));
  assert.throws(
    () => validateTerms(baseTerms({ underlyingAmount: 0n })),
    TermsError,
  );
  assert.throws(
    () => validateTerms(baseTerms({ acceptanceDeadline: 1_800_600_001 })),
    /on or before/,
  );
  assert.equal(displayStrike(225_000_000n, 250_000_000n, 9), '900');
  assert.equal(parseUnits('0.25', 9), 250_000_000n);
  assert.throws(() => parseUnits('0.0000000001', 9), /decimal places/);
  const summary = summarise(baseTerms(), 9);
  assert.equal(summary.underlyingAmount, '0.25');
  assert.equal(summary.sellerReceivesIfExercised, '231.5');
});

// -------------------------------------------------------------- resolver

void test('publisher quotes attach by mint, never by a matching-looking name', () => {
  const assets = [byId('prestocks:anthropic')!, byId('prestocks:openai')!];
  const chain = new Map(
    assets.map((asset) => [
      asset.mint,
      parseMintAccount(asset.mint, 'mainnet', mintAccount(PRESTOCKS_EXTS)),
    ]),
  );
  const resolved = resolveAssets(
    assets,
    chain,
    parsePreStocks(PRESTOCKS_BODY, AT),
  );
  assert.equal(resolved[0].quote?.symbol, 'ANTHROPIC');
  assert.equal(resolved[1].quote, null);
  assert.deepEqual(escrowable(resolved), []);
});

void test('every reviewed asset declares publisher rights and restrictions', () => {
  for (const asset of registry) {
    assert.equal(asset.provider, 'prestocks');
    assert.ok(asset.issuerTerms.issuerRights.length, `${asset.id} rights`);
    assert.ok(
      asset.issuerTerms.restrictions.length,
      `${asset.id} restrictions`,
    );
    assert.equal(asset.expectedTokenProgram, TOKEN_2022);
  }
});

// ----------------------------------------------------- feed resilience

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const statusResponse = (status: number) =>
  new Response('upstream failed', { status });
const noSleep = { sleep: async () => {} };

void test('a publisher 5xx is retried and the next result is used', async () => {
  let calls = 0;
  const impl = (async () => {
    calls++;
    return calls < 3 ? statusResponse(500) : jsonResponse(PRESTOCKS_BODY);
  }) as unknown as typeof fetch;
  const quotes = await fetchPreStocks(impl, undefined, {
    ...noSleep,
    attempts: 3,
  });
  assert.equal(calls, 3);
  assert.equal(quotes[0].symbol, 'ANTHROPIC');
});

void test('a publisher 4xx is raised without retrying', async () => {
  let calls = 0;
  const impl = (async () => {
    calls++;
    return statusResponse(404);
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchPreStocks(impl, undefined, { ...noSleep, attempts: 3 }),
    /PreStocks responded 404/,
  );
  assert.equal(calls, 1);
});

void test('the endpoint falls back to its last complete publisher catalog', async () => {
  resetAssetCache();
  const config = {
    verifyRpcUrl: 'http://127.0.0.1:1',
    verifyNetwork: 'mainnet' as const,
    programId: null,
    usdcMint: null,
  };
  let up = true;
  const impl = (async () =>
    up
      ? jsonResponse(PRESTOCKS_BODY)
      : statusResponse(503)) as unknown as typeof fetch;
  const first = await loadAssets(config, 1_000, impl, noSleep);
  assert.equal(first.catalog.length, 1);
  up = false;
  const second = await loadAssets(config, 200_000, impl, noSleep);
  assert.equal(second.catalog.length, 1);
  assert.equal(second.priceState, 'stale');
  assert.equal(second.priceObservedAt, new Date(1_000).toISOString());
  assert.equal(second.refreshedAt, new Date(1_000).toISOString());
  assert.deepEqual(
    second.warnings.filter((w) => w.includes('prices')),
    [],
  );
});

void test('an unseen publisher outage is a single clear warning', async () => {
  resetAssetCache();
  const impl = (async () => statusResponse(503)) as unknown as typeof fetch;
  const payload = await loadAssets(
    {
      verifyRpcUrl: 'http://127.0.0.1:1',
      verifyNetwork: 'mainnet',
      programId: null,
      usdcMint: null,
    },
    1_000,
    impl,
    noSleep,
  );
  assert.equal(payload.warnings.filter((w) => w.includes('prices')).length, 1);
  assert.ok(payload.warnings[0].startsWith('PreStocks prices'));
});
