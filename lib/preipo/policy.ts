import { SPL_TOKEN, TOKEN_2022 } from './registry';
import type {
  EscrowBlocker,
  EscrowVerdict,
  MintExtension,
  OnchainMint,
  RegistryAsset,
} from './types';

/**
 * Token-2022 extensions this version can escrow safely.
 *
 * The covered call makes two promises: the escrowed tokens are delivered to
 * the buyer on exercise, and the seller can recover them after expiry
 * without our backend. An extension that lets a third party move, freeze or
 * halt those tokens breaks both promises, so it is a hard rejection rather
 * than a warning.
 */
const SUPPORTED: MintExtension[] = [
  'transferFeeConfig', // handled with fee-aware integer math
  'metadataPointer',
  'tokenMetadata',
  'groupPointer',
  'groupMemberPointer',
  'immutableOwner',
  // Allowed but disclosed below: the issuer sets the default state for new
  // accounts, which matters only if they switch it to frozen.
  'defaultAccountState',
];

const BLOCKING: Partial<Record<MintExtension, EscrowBlocker>> = {
  permanentDelegate: {
    code: 'permanent-delegate',
    detail:
      'The mint has a permanent delegate. The issuer can move tokens out of the escrow account at any time, so escrowed collateral cannot be guaranteed to the buyer.',
  },
  pausableConfig: {
    code: 'pausable',
    detail:
      'The mint is pausable. A pause would block exercise and expiry recovery, so the seller could not reclaim collateral without the issuer.',
  },
  transferHook: {
    code: 'transfer-hook',
    detail:
      'The mint has a transfer hook. Transfers run issuer-controlled code that can reject them, and every transfer needs extra accounts this version does not resolve.',
  },
  nonTransferable: {
    code: 'non-transferable',
    detail: 'The mint is non-transferable, so it cannot be escrowed at all.',
  },
  confidentialTransferMint: {
    code: 'confidential-transfer',
    detail:
      'The mint supports confidential transfers. Escrow balances would not be publicly verifiable.',
  },
  confidentialTransferFeeConfig: {
    code: 'confidential-transfer',
    detail:
      'The mint carries a confidential transfer fee configuration, so transferred amounts and fees may not be publicly verifiable.',
  },
  scaledUiAmountConfig: {
    code: 'mutable-ui-multiplier',
    detail:
      'The mint has a scaled UI amount multiplier the issuer can change. The relationship between displayed amounts and base units is not fixed for the life of the contract.',
  },
};

/**
 * Decide whether a mint may back a covered call.
 *
 * `asset` is the curated expectation; `onchain` is what the chain actually
 * says. Disagreement is always a rejection: a mint whose decimals or owning
 * program changed is a different instrument, not a stale row.
 */
export function evaluateMint(
  asset: RegistryAsset,
  onchain: OnchainMint | null,
): { verdict: EscrowVerdict; registryMismatch: string[] } {
  const blockers: EscrowBlocker[] = [];
  const disclosures: string[] = [];
  const registryMismatch: string[] = [];

  if (!onchain)
    return {
      verdict: {
        escrowSupported: false,
        blockers: [
          {
            code: 'unknown-extension',
            detail:
              'The mint could not be read from the configured RPC, so nothing about it has been verified.',
          },
        ],
        disclosures,
      },
      registryMismatch,
    };

  if (onchain.mint !== asset.mint)
    registryMismatch.push(
      `Registry mint ${asset.mint} does not match the account read (${onchain.mint}).`,
    );
  if (onchain.tokenProgram !== asset.expectedTokenProgram)
    registryMismatch.push(
      `Expected token program ${asset.expectedTokenProgram}, chain reports ${onchain.tokenProgram}.`,
    );
  if (onchain.decimals !== asset.expectedDecimals)
    registryMismatch.push(
      `Expected ${asset.expectedDecimals} decimals, chain reports ${onchain.decimals}.`,
    );

  if (onchain.tokenProgram !== TOKEN_2022 && onchain.tokenProgram !== SPL_TOKEN)
    blockers.push({
      code: 'unsupported-token-program',
      detail: `Owning program ${onchain.tokenProgram} is neither SPL Token nor Token-2022.`,
    });

  if (onchain.decimals > 18)
    blockers.push({
      code: 'decimals-out-of-range',
      detail: `${onchain.decimals} decimals exceeds the supported range.`,
    });

  for (const ext of onchain.extensions) {
    const blocker = BLOCKING[ext];
    if (blocker) {
      blockers.push(blocker);
      continue;
    }
    if (!SUPPORTED.includes(ext))
      blockers.push({
        code: 'unknown-extension',
        detail: `Extension "${ext}" is not on the reviewed list, so its effect on escrow is unverified.`,
      });
  }

  for (const ext of onchain.unknownExtensions)
    blockers.push({
      code: 'unknown-extension',
      detail: `Extension "${ext}" is not recognised by this build.`,
    });

  // `defaultAccountState: frozen` means a fresh escrow account starts frozen
  // and needs the issuer to thaw it before anything can be deposited.
  if (onchain.extensions.includes('defaultAccountState'))
    disclosures.push(
      'New token accounts for this mint follow an issuer-set default state. If the issuer switches that default to frozen, new escrow accounts will require issuer action.',
    );

  if (onchain.transferFeeBasisPoints)
    disclosures.push(
      `Every transfer of this token withholds a ${(onchain.transferFeeBasisPoints / 100).toFixed(2)}% issuer fee. The contract records the amount the escrow actually received, so the buyer receives exactly that and the fee is never silently borne by the buyer.`,
    );

  if (onchain.freezeAuthority)
    disclosures.push(
      'The issuer holds freeze authority and can freeze the escrow account, which would delay exercise or expiry recovery until unfrozen.',
    );

  // Two extensions can map to the same reason; state it once.
  // Several extensions can raise the same reason; state each code once.
  const seen = new Set<string>();
  const unique = blockers.filter((b) => {
    if (seen.has(b.code)) return false;
    seen.add(b.code);
    return true;
  });
  return {
    verdict: {
      escrowSupported: unique.length === 0 && registryMismatch.length === 0,
      blockers: unique,
      disclosures,
    },
    registryMismatch,
  };
}

/**
 * Transfer-fee aware arithmetic, mirroring Token-2022's calculation:
 * fee = ceil(amount * bps / 10_000), capped at `maximum`.
 * All values are base units held as bigints; there is no floating point.
 */
export function transferFee(
  amount: bigint,
  basisPoints: number | null,
  maximum: string | null,
): bigint {
  if (!basisPoints) return 0n;
  if (basisPoints >= 10_000)
    throw new Error('Transfer fee basis points must be below 10000.');
  const raw = (amount * BigInt(basisPoints) + 9_999n) / 10_000n;
  const cap = maximum === null ? null : BigInt(maximum);
  return cap !== null && raw > cap ? cap : raw;
}

/** What the escrow actually receives when `gross` is sent. */
export const netAfterFee = (
  gross: bigint,
  basisPoints: number | null,
  maximum: string | null,
) => gross - transferFee(gross, basisPoints, maximum);
