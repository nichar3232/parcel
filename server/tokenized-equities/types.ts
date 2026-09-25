/**
 * Common read model for an issuer-declared equity token on Solana.
 *
 * These values deliberately describe issuer inventory and issuer market data;
 * they do not make a token eligible as Parcel collateral or an underlying for
 * the deterministic sandbox ledger.
 */
export type TokenizedEquityProvider = 'xstocks' | 'superstate' | 'ondo';

export interface TokenizedEquityAsset {
  /** Stable source-qualified identity, for example `xstocks:NVDAx`. */
  id: string;
  provider: TokenizedEquityProvider;
  providerName: string;
  symbol: string;
  name: string;
  underlyingSymbol: string;
  underlyingType: 'Equity' | 'ETF' | null;
  logo: string | null;
  description: string | null;
  mint: string;
  isTradingHalted: boolean;
  marketOpen: boolean | null;
  nextChangeAt: string | null;
}

export interface TokenizedEquityQuote {
  id: string;
  quote: number | null;
  /** Issuer-provided observation time. Null means the source did not publish one. */
  observedAt: number | null;
  /** Time Parcel received the issuer response; not a claimed venue timestamp. */
  receivedAt: number | null;
  state: 'live' | 'unavailable' | 'pending';
  provider: TokenizedEquityProvider;
}

export interface TokenizedEquitySource {
  id: TokenizedEquityProvider;
  name: string;
  /**
   * `pending` is deliberately distinct from `unavailable`: it means Parcel
   * has started a cold issuer-registry read and is serving an immediate
   * snapshot while that one shared read completes.
   */
  state: 'live' | 'cached' | 'pending' | 'unavailable' | 'not-configured';
  assets: number;
  detail: string;
}

export interface TokenizedEquityCatalog {
  assets: TokenizedEquityAsset[];
  sources: TokenizedEquitySource[];
  refreshedAt: number;
}
