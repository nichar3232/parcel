import type { RegistryAsset } from './types';

export const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Curated pre-IPO assets.
 *
 * Every field was read from the provider's public API and then checked
 * against mainnet on 2026-09-16; see docs/PREIPO.md for the transcript.
 * `expectedTokenProgram` and `expectedDecimals` are assertions: if the
 * chain disagrees at runtime the asset is rejected rather than adjusted,
 * because a changed mint is a different instrument.
 *
 * These are mainnet issuer assets. Nothing in this repository spends them.
 * Automated tests use local test mints instead (see lib/preipo/testMints.ts).
 */
export const registry: RegistryAsset[] = [
  {
    id: 'tessera:t-openai',
    provider: 'tessera',
    network: 'mainnet',
    mint: 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ',
    displayName: 'Tessera T-OpenAI',
    symbol: 'T-OpenAI',
    expectedTokenProgram: TOKEN_2022,
    expectedDecimals: 9,
    issuerTerms: {
      issuer: 'Tessera',
      instrument:
        'A Tessera-issued Token-2022 T-Token tracking OpenAI exposure. Holding a token is not holding OpenAI stock and confers no shareholder rights.',
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
    },
  },
  {
    id: 'tessera:t-kalshi',
    provider: 'tessera',
    network: 'mainnet',
    mint: 'TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ',
    displayName: 'Tessera T-Kalshi',
    symbol: 'T-Kalshi',
    expectedTokenProgram: TOKEN_2022,
    expectedDecimals: 9,
    issuerTerms: {
      issuer: 'Tessera',
      instrument:
        'A Tessera-issued Token-2022 T-Token tracking Kalshi exposure. Holding a token is not holding Kalshi stock and confers no shareholder rights.',
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
    },
  },
  {
    id: 'prestocks:anthropic',
    provider: 'prestocks',
    network: 'mainnet',
    mint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    displayName: 'Anthropic PreStocks',
    symbol: 'ANTHROPIC',
    expectedTokenProgram: TOKEN_2022,
    expectedDecimals: 9,
    issuerTerms: {
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
    },
  },
  {
    id: 'prestocks:anduril',
    provider: 'prestocks',
    network: 'mainnet',
    mint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
    displayName: 'Anduril PreStocks',
    symbol: 'ANDURIL',
    expectedTokenProgram: TOKEN_2022,
    expectedDecimals: 9,
    issuerTerms: {
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
    },
  },
];

export const byId = (id: string) => registry.find((a) => a.id === id) || null;

/** Two assets are interchangeable only if they are the same registry entry. */
export const sameInstrument = (a: RegistryAsset, b: RegistryAsset) =>
  a.id === b.id && a.mint === b.mint && a.provider === b.provider;
