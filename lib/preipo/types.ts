/**
 * Pre-IPO token types.
 *
 * Quantities here are ALWAYS token base units of a sponsor-issued token.
 * They are not company shares. A PreStocks token is a distinct instrument
 * from the underlying company; nothing in this module may treat the two as
 * interchangeable.
 */

export type ProviderId = 'prestocks';

export type SolanaNetwork = 'mainnet' | 'devnet' | 'localnet';

/** Token-2022 extensions we recognise. Anything unlisted is unknown. */
export type MintExtension =
  | 'transferFeeConfig'
  | 'metadataPointer'
  | 'tokenMetadata'
  | 'permanentDelegate'
  | 'transferHook'
  | 'pausableConfig'
  | 'defaultAccountState'
  | 'confidentialTransferMint'
  | 'confidentialTransferFeeConfig'
  | 'scaledUiAmountConfig'
  | 'nonTransferable'
  | 'interestBearingConfig'
  | 'groupPointer'
  | 'groupMemberPointer'
  | 'memoTransfer'
  | 'cpiGuard'
  | 'immutableOwner';

/** What a provider's public API told us. Informational only. */
export interface ProviderQuote {
  provider: ProviderId;
  /** The provider's own symbol, e.g. "ANTHROPIC". */
  symbol: string;
  displayName: string;
  /** Base58 mint address as published by the provider. */
  mint: string;
  /**
   * Provider mark price in USD per token, or null when unpublished.
   * NEVER a settlement oracle: contracts settle on their own fixed
   * integer USDC amounts, not on this number.
   */
  markPriceUsd: number | null;
  /** Free-form extras the provider publishes; surfaced, never trusted. */
  meta: Record<string, string | number | null>;
  /** When we fetched it. */
  fetchedAt: string;
}

/** Mint facts read from the chain, not from a provider API. */
export interface OnchainMint {
  mint: string;
  network: SolanaNetwork;
  /** Owning token program: SPL Token or Token-2022. */
  tokenProgram: string;
  decimals: number;
  supplyBaseUnits: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: MintExtension[];
  /** Unrecognised extension names, treated as unsupported. */
  unknownExtensions: string[];
  /** Transfer fee in basis points, when the mint charges one. */
  transferFeeBasisPoints: number | null;
  /** Maximum fee per transfer in base units, as a decimal string. */
  transferFeeMaximum: string | null;
  /** True when the issuer can seize tokens from any account. */
  hasPermanentDelegate: boolean;
  /** True when transfers can be globally halted by the issuer. */
  pausable: boolean;
  /** True when a transfer hook program is configured. */
  hasTransferHook: boolean;
  observedAt: string;
}

/** Result of running a mint through the escrow policy. */
export interface EscrowVerdict {
  /** Whether this mint may back a covered call in this version. */
  escrowSupported: boolean;
  /** Machine-readable reasons, empty when supported. */
  blockers: EscrowBlocker[];
  /** Conditions that are handled but must be disclosed to the user. */
  disclosures: string[];
}

export interface EscrowBlocker {
  code:
    | 'permanent-delegate'
    | 'pausable'
    | 'transfer-hook'
    | 'non-transferable'
    | 'default-frozen'
    | 'mutable-ui-multiplier'
    | 'confidential-transfer'
    | 'unknown-extension'
    | 'unsupported-token-program'
    | 'decimals-out-of-range';
  detail: string;
}

/** A curated, human-reviewed registry entry. */
export interface RegistryAsset {
  /** Stable internal id, namespaced by provider. */
  id: string;
  provider: ProviderId;
  network: SolanaNetwork;
  mint: string;
  displayName: string;
  symbol: string;
  /** The company's mark, for a provider whose feed publishes none. */
  logo?: string;
  /** Expected token program; a mismatch on chain is a hard rejection. */
  expectedTokenProgram: string;
  /** Expected decimals; a mismatch on chain is a hard rejection. */
  expectedDecimals: number;
  /** Issuer rights and eligibility restrictions, shown before signing. */
  issuerTerms: IssuerTerms;
}

export interface IssuerTerms {
  issuer: string;
  /** What the token represents, in the issuer's own framing. */
  instrument: string;
  /** Rights the issuer retains over the token. */
  issuerRights: string[];
  /** Eligibility or transfer restrictions a holder must know about. */
  restrictions: string[];
  /** Where the issuer documents the above. */
  reference: string;
}

/** A registry entry joined with what the chain and the provider say. */
export interface ResolvedAsset {
  asset: RegistryAsset;
  onchain: OnchainMint | null;
  quote: ProviderQuote | null;
  verdict: EscrowVerdict;
  /** Set when the chain contradicts the curated registry entry. */
  registryMismatch: string[];
}
