import type { RegistryAsset } from './types';

export const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Curated pre-IPO assets: every token both providers publish.
 *
 * Each issuer's terms are identical across its own line, so they are
 * written once and applied to every mint rather than copied per asset,
 * where one of eleven copies drifts and nobody notices.
 *
 * `expectedTokenProgram` and `expectedDecimals` are assertions, not
 * defaults. If the chain disagrees at runtime the asset is rejected
 * rather than adjusted, because a changed mint is a different
 * instrument. Mints were read from the providers' public APIs; see
 * docs/PREIPO.md.
 *
 * These are mainnet issuer assets. Nothing in this repository spends
 * them. Automated tests use local test mints (lib/preipo/testMints.ts).
 */

const TESSERA_TERMS = {
  issuer: 'Tessera',
  issuerRights: [
    'Freeze authority is set, so the issuer can freeze any token account including an escrow account.',
    'A 0.20% (20 bps) transfer fee is withheld on every transfer, with no maximum cap.',
    'The transfer-fee configuration authority can change that fee for future transfers.',
  ],
  restrictions: [
    'Transfers are subject to the issuer’s own eligibility rules.',
    'Quantities are denominated in T-Tokens, never in company shares.',
  ],
  reference: 'https://docs.tessera.pe',
};

const PRESTOCKS_TERMS = {
  issuer: 'PreStocks',
  instrument:
    'A PreStocks-issued Token-2022 token backed 1:1 by SPV exposure tracking the private company’s price. Holding a token is not holding company stock.',
  issuerRights: [
    'A permanent delegate is configured: the issuer can move tokens out of any account, including a program escrow, at any time.',
    'Transfers are pausable by the issuer, which would block exercise and expiry recovery.',
    'A transfer hook is configured on the mint.',
    'A scaled UI amount multiplier is configured and can be changed by the issuer, altering the displayed-to-base-unit relationship.',
    'A 0.50% (50 bps) transfer fee is withheld, changeable by the issuer.',
    'Freeze authority is set.',
  ],
  restrictions: [
    'Transfers are subject to the issuer’s eligibility and SPV terms.',
    'Quantities are denominated in PreStocks tokens, never in company shares.',
  ],
  reference: 'https://prestocks.com/products',
};

/* Tessera's feed carries no image, so its rows borrow the company mark
   PreStocks publishes for the same company. It is the company's logo
   either way; only the host differs. */
const COMPANY_LOGO = (company: string) =>
  `https://www.prestocks.com/logos/${company.toLowerCase().replace(/\s+/g, '')}.png`;

const tessera = (
  company: string,
  symbol: string,
  mint: string,
): RegistryAsset => ({
  id: `tessera:${symbol.toLowerCase()}`,
  provider: 'tessera',
  network: 'mainnet',
  mint,
  displayName: `Tessera ${symbol}`,
  symbol,
  logo: COMPANY_LOGO(company),
  expectedTokenProgram: TOKEN_2022,
  expectedDecimals: 9,
  issuerTerms: {
    ...TESSERA_TERMS,
    instrument: `A Tessera-issued Token-2022 T-Token tracking ${company} exposure. Holding a token is not holding ${company} stock and confers no shareholder rights.`,
  },
});

const prestocks = (
  company: string,
  symbol: string,
  mint: string,
): RegistryAsset => ({
  id: `prestocks:${symbol.toLowerCase()}`,
  provider: 'prestocks',
  network: 'mainnet',
  mint,
  displayName: `${company} PreStocks`,
  symbol,
  logo: COMPANY_LOGO(company),
  expectedTokenProgram: TOKEN_2022,
  expectedDecimals: 9,
  issuerTerms: PRESTOCKS_TERMS,
});

/** The company mark for a registry symbol, or null for anything else. */
export const logoOf = (symbol: string) =>
  registry.find((a) => a.symbol === symbol)?.logo ?? null;

export const registry: RegistryAsset[] = [
  tessera('OpenAI', 'T-OpenAI', 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ'),
  tessera('Kalshi', 'T-Kalshi', 'TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ'),
  tessera('SpaceX', 'T-SpaceX', 'TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v'),
  prestocks('OpenAI', 'OPENAI', 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF'),
  prestocks(
    'Anthropic',
    'ANTHROPIC',
    'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
  ),
  prestocks('SpaceX', 'SPACEX', 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'),
  prestocks(
    'Anduril',
    'ANDURIL',
    'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
  ),
  prestocks(
    'Neuralink',
    'NEURALINK',
    'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
  ),
  prestocks(
    'Figure AI',
    'FIGUREAI',
    'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd',
  ),
  prestocks('Kalshi', 'KALSHI', 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua'),
  prestocks(
    'Polymarket',
    'POLYMARKET',
    'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
  ),
];

export const byId = (id: string) => registry.find((a) => a.id === id) || null;

/** Two assets are interchangeable only if they are the same registry entry. */
export const sameInstrument = (a: RegistryAsset, b: RegistryAsset) =>
  a.id === b.id && a.mint === b.mint && a.provider === b.provider;
