import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTessera, parseTessera } from '../lib/preipo/providers/tessera';
import { parsePreStocks } from '../lib/preipo/providers/prestocks';
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

const AT = '2026-09-16T00:00:00.000Z';

/** Captured verbatim from the live endpoint on 2026-09-16. */
const TESSERA_BODY = [
  {
    id: 'T-OpenAI',
    name: 'T-OpenAI',
    symbol: 'T-OpenAI',
    code: 'tOpenAI',
    sector: 'Artificial Intelligence',
    mint: 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ',
    markPrice: 812.79,
    holders: 8259,
    markValuation: 950000000000,
  },
];

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

const TESSERA_EXTS = [
  {
    extension: 'transferFeeConfig',
    state: {
      newerTransferFee: {
        epoch: 987,
        maximumFee: '18446744073709551615',
        transferFeeBasisPoints: 20,
      },
    },
  },
  { extension: 'metadataPointer' },
  { extension: 'tokenMetadata' },
];

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

// ----------------------------------------------------------- adapters

void test('provider adapters read each issuer’s own schema', () => {
  const [t] = parseTessera(TESSERA_BODY, AT);
  assert.equal(t.provider, 'tessera');
  assert.equal(t.mint, 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ');
  assert.equal(t.markPriceUsd, 812.79);

  const [p] = parsePreStocks(PRESTOCKS_BODY, AT);
  assert.equal(p.provider, 'prestocks');
  // PreStocks publishes the mint as contract_address, not mint.
  assert.equal(p.mint, 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw');
  assert.equal(p.meta.tokenPrice, 956.7206391833798);
});

void test('a Tessera payload cannot be read as a PreStocks payload', () => {
  assert.throws(() => parsePreStocks(TESSERA_BODY, AT), /contract_address/);
  assert.throws(() => parseTessera(PRESTOCKS_BODY, AT), /"mint"/);
});

void test('adapters reject non-array and malformed bodies', () => {
  assert.throws(() => parseTessera({ tokens: [] }, AT), /array/);
  assert.throws(() => parsePreStocks('nope', AT), /array/);
  assert.throws(() => parseTessera([{ ...TESSERA_BODY[0], mint: '' }], AT));
});

// -------------------------------------------------------------- chain

void test('mint parsing keeps the network and separates unknown extensions', () => {
  const m = parseMintAccount(
    registry[0].mint,
    'mainnet',
    mintAccount([...TESSERA_EXTS, { extension: 'someFutureThing' }]),
  );
  assert.ok(m);
  assert.equal(m.network, 'mainnet');
  assert.equal(m.decimals, 9);
  assert.equal(m.tokenProgram, TOKEN_2022);
  assert.equal(m.transferFeeBasisPoints, 20);
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

// ------------------------------------------------------------- policy

void test('Tessera mints are escrowable, with the transfer fee disclosed', () => {
  const asset = byId('tessera:t-openai')!;
  const m = parseMintAccount(asset.mint, 'mainnet', mintAccount(TESSERA_EXTS))!;
  const { verdict } = evaluateMint(asset, m);
  assert.equal(verdict.escrowSupported, true);
  assert.equal(verdict.blockers.length, 0);
  assert.ok(verdict.disclosures.some((d) => d.includes('0.20%')));
  assert.ok(verdict.disclosures.some((d) => d.includes('freeze')));
});

void test('PreStocks mints are rejected, naming every reason', () => {
  const asset = byId('prestocks:anthropic')!;
  const m = parseMintAccount(
    asset.mint,
    'mainnet',
    mintAccount(PRESTOCKS_EXTS),
  )!;
  const { verdict } = evaluateMint(asset, m);
  assert.equal(verdict.escrowSupported, false);
  const codes = verdict.blockers.map((b) => b.code).sort();
  assert.deepEqual(codes, [
    'mutable-ui-multiplier',
    'pausable',
    'permanent-delegate',
    'transfer-hook',
  ]);
});

void test('a mint that no longer matches the registry is rejected outright', () => {
  const asset = byId('tessera:t-openai')!;
  const drifted = parseMintAccount(asset.mint, 'mainnet', {
    ...mintAccount(TESSERA_EXTS),
    data: {
      parsed: {
        type: 'mint',
        info: { decimals: 6, supply: '1', extensions: TESSERA_EXTS },
      },
    },
  })!;
  const { verdict, registryMismatch } = evaluateMint(asset, drifted);
  assert.equal(verdict.escrowSupported, false);
  assert.ok(registryMismatch.some((m) => m.includes('decimals')));
});

void test('an unreadable mint is never treated as supported', () => {
  const { verdict } = evaluateMint(registry[0], null);
  assert.equal(verdict.escrowSupported, false);
});

// --------------------------------------------------------- transfer fee

void test('transfer fee rounds up and respects the cap, like Token-2022', () => {
  assert.equal(transferFee(10_000n, 20, null), 20n);
  assert.equal(transferFee(1n, 20, null), 1n); // ceil, never truncate to zero
  assert.equal(transferFee(10_000n, 20, '5'), 5n);
  assert.equal(transferFee(10_000n, 0, null), 0n);
  assert.equal(transferFee(10_000n, null, null), 0n);
  assert.equal(netAfterFee(10_000n, 20, null), 9_980n);
  assert.throws(() => transferFee(1n, 10_000, null), /below 10000/);
});

// --------------------------------------------------------------- terms

const baseTerms = (over: Partial<CoveredCallTerms> = {}): CoveredCallTerms => ({
  underlyingMint: registry[0].mint,
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  underlyingAmount: 250_000_000n, // 0.25 tokens at 9 decimals
  totalExercisePayment: 225_000_000n, // 225 USDC at 6 decimals
  totalPremium: 6_500_000n, // 6.50 USDC
  acceptanceDeadline: 1_800_000_000,
  exerciseExpiry: 1_800_600_000,
  designatedBuyer: null,
  ...over,
});

void test('terms validation mirrors the program’s rules', () => {
  assert.doesNotThrow(() => validateTerms(baseTerms()));
  assert.throws(
    () => validateTerms(baseTerms({ underlyingAmount: 0n })),
    TermsError,
  );
  assert.throws(
    () => validateTerms(baseTerms({ totalPremium: 0n })),
    TermsError,
  );
  // acceptance must close no later than expiry
  assert.throws(
    () =>
      validateTerms(
        baseTerms({
          acceptanceDeadline: 1_800_600_001,
          exerciseExpiry: 1_800_600_000,
        }),
      ),
    /on or before/,
  );
  assert.throws(
    () => validateTerms(baseTerms({ usdcMint: registry[0].mint })),
    /must differ/,
  );
  assert.throws(
    () => validateTerms(baseTerms({ underlyingAmount: 1n << 64n })),
    /u64/,
  );
});

void test('the per-token strike is derived from the totals, not stored', () => {
  // 225 USDC for 0.25 tokens => 900 USDC per token.
  assert.equal(displayStrike(225_000_000n, 250_000_000n, 9), '900');
  // A total that does not divide evenly still renders faithfully.
  assert.equal(displayStrike(1n, 3_000_000_000n, 9), '0.000000333333');
});

void test('decimal parsing refuses precision the token cannot hold', () => {
  assert.equal(parseUnits('0.25', 9), 250_000_000n);
  assert.equal(parseUnits('1', 6), 1_000_000n);
  assert.throws(() => parseUnits('0.0000000001', 9), /decimal places/);
  assert.throws(() => parseUnits('-1', 9), /positive decimal/);
  assert.throws(() => parseUnits('1e9', 9), /positive decimal/);
});

void test('the summary states both sides’ exposure', () => {
  const s = summarise(baseTerms(), 9);
  assert.equal(s.underlyingAmount, '0.25');
  assert.equal(s.totalPremium, '6.5');
  assert.equal(s.totalExercisePayment, '225');
  assert.equal(s.derivedStrikePerToken, '900');
  // Seller keeps the premium if never exercised; gets premium + strike if it is.
  assert.equal(s.sellerKeepsIfUnexercised, '6.5');
  assert.equal(s.sellerReceivesIfExercised, '231.5');
  // The buyer's worst case is exactly the premium.
  assert.equal(s.buyerMaxLoss, '6.5');
});

// ------------------------------------------------------------ resolver

void test('quotes attach by mint, never by symbol', () => {
  const assets = [byId('tessera:t-openai')!, byId('prestocks:anthropic')!];
  const chain = new Map([
    [
      assets[0].mint,
      parseMintAccount(assets[0].mint, 'mainnet', mintAccount(TESSERA_EXTS)),
    ],
    [
      assets[1].mint,
      parseMintAccount(assets[1].mint, 'mainnet', mintAccount(PRESTOCKS_EXTS)),
    ],
  ]);
  const quotes = [
    ...parseTessera(TESSERA_BODY, AT),
    // Same symbol, wrong provider and mint: must not attach.
    { ...parsePreStocks(PRESTOCKS_BODY, AT)[0], mint: assets[0].mint },
  ];
  const resolved = resolveAssets(assets, chain, quotes);
  assert.equal(resolved[0].quote?.provider, 'tessera');
  assert.equal(resolved[1].quote, null);
  // Only the Tessera asset may back a contract.
  assert.deepEqual(
    escrowable(resolved).map((r) => r.asset.id),
    ['tessera:t-openai'],
  );
});

void test('every registry entry declares issuer rights and restrictions', () => {
  for (const a of registry) {
    assert.ok(a.issuerTerms.issuerRights.length, `${a.id} rights`);
    assert.ok(a.issuerTerms.restrictions.length, `${a.id} restrictions`);
    assert.equal(a.expectedTokenProgram, TOKEN_2022);
    // Quantities are tokens, never company shares.
    assert.ok(
      a.issuerTerms.restrictions.some((r) => /never in company shares/.test(r)),
      `${a.id} must state tokens are not shares`,
    );
  }
});

/* ------------------------------------------------------------------
   Provider feed resilience.

   Both endpoints are public and polled on a timer from one address, and
   both return the occasional 5xx under that. A blip used to travel all
   the way to a banner across the desk saying the price feed was
   unavailable, which is alarming and wrong: the endpoint answers on the
   next attempt, and the prices are informational either way.
   ------------------------------------------------------------------ */

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const statusResponse = (status: number) =>
  new Response('upstream failed', { status });

/** Never actually sleep; the backoff schedule is not what is under test. */
const noSleep = { sleep: async () => {} };

void test('a 500 is retried and the next attempt is believed', async () => {
  let calls = 0;
  const impl = (async () => {
    calls++;
    return calls < 3 ? statusResponse(500) : jsonResponse(TESSERA_BODY);
  }) as unknown as typeof fetch;

  const quotes = await fetchTessera(impl, undefined, {
    ...noSleep,
    attempts: 3,
  });
  assert.equal(calls, 3);
  assert.equal(quotes[0].symbol, 'T-OpenAI');
});

void test('a 4xx is raised at once rather than retried', async () => {
  let calls = 0;
  const impl = (async () => {
    calls++;
    return statusResponse(404);
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => fetchTessera(impl, undefined, { ...noSleep, attempts: 3 }),
    /Tessera responded 404/,
  );
  // Asking a second time cannot make a wrong request right.
  assert.equal(calls, 1);
});

void test('a transport error is retried, and the last one is reported', async () => {
  let calls = 0;
  const impl = (async () => {
    calls++;
    throw new Error('socket hang up');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => fetchTessera(impl, undefined, { ...noSleep, attempts: 2 }),
    /socket hang up/,
  );
  assert.equal(calls, 2);
});

void test('an exhausted feed keeps serving the prices it last had', async () => {
  resetAssetCache();
  const config = {
    verifyRpcUrl: 'http://127.0.0.1:1',
    verifyNetwork: 'mainnet' as const,
    programId: null,
    usdcMint: null,
  };

  let up = true;
  const impl = (async (url: string) => {
    if (!up) return statusResponse(500);
    return jsonResponse(
      String(url).includes('tessera') ? TESSERA_BODY : PRESTOCKS_BODY,
    );
  }) as unknown as typeof fetch;

  const first = await loadAssets(config, 1_000, impl, noSleep);
  const priced = first.assets.filter((a) => a.quote).length;
  assert.ok(priced > 0, 'the healthy read should price some assets');
  assert.deepEqual(
    first.warnings.filter((w) => w.includes('price')),
    [],
  );

  // Both feeds fall over, and the TTL has expired so the cache cannot
  // hide it. The prices must survive anyway, and say nothing about it.
  up = false;
  const second = await loadAssets(config, 200_000, impl, noSleep);
  assert.equal(second.assets.filter((a) => a.quote).length, priced);
  assert.deepEqual(
    second.warnings.filter((w) => w.includes('price')),
    [],
  );
});

void test('a feed that has never answered says so once', async () => {
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
  assert.equal(payload.warnings.filter((w) => w.includes('price')).length, 2);
  assert.ok(payload.warnings.some((w) => w.startsWith('Tessera prices')));
});
