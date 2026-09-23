/** 'USDC', or the symbol of any underlying in the universe. */
export type Asset = string;
export type Side = 'buy' | 'sell';
export type OptionKind = 'call' | 'put';
/** Amounts per asset. USDC is always present; underlyings default to 0. */
export type Balances = Record<string, number>;
export interface Leg {
  kind: OptionKind;
  side: Side;
  strike: number;
  ratio: number;
}
export interface CurveTerms {
  shape: 'quadratic' | 'exponential';
  side: Side;
  direction: 'up' | 'down';
  lower: number;
  upper: number;
  cap: number; // Maximum USDC payoff per share-equivalent.
}
export interface OrderTerms {
  curve?: CurveTerms;
  /** The underlying the contract is written on. */
  symbol: string;
  name: string;
  quantity: number;
  expiry: string;
  legs: Leg[];
  settlement: 'physical' | 'cash';
  reference: 'stock' | 'dividend';
}
export interface OptionPosition {
  id: string;
  terms: OrderTerms;
  premium: number;
  opened: string;
  status: 'active' | 'settled' | 'closed';
  cashFlow?: number;
  stockFlow?: number;
}
export interface LendingPosition {
  productive?: { entry: number; cap: number; premium: number };
  id: string;
  symbol: string;
  quantity: number;
  opened: string;
  expiry: string;
  collateral: number;
  prepaidInterest: number;
  apr: number;
  status: 'active' | 'closed';
  earned: number;
}
export interface ShortPosition {
  id: string;
  symbol: string;
  quantity: number;
  entry: number;
  cap: number;
  premium: number;
  opened: string;
  expiry: string;
  maxInterest: number;
  status: 'active' | 'closed';
  pnl?: number;
}
/**
 * Cash drawn from the pool against stock left in the vault.
 *
 * The pledge stays where it is and is reserved, the way shares under a
 * covered call are. Interest is a claim on the vault rather than an
 * escrow: it is settled when the loan is, so nothing is taken out of
 * spendable cash while the loan runs.
 */
export interface BorrowPosition {
  id: string;
  /** The stock pledged against the loan. */
  symbol: string;
  pledged: number;
  /** USDC drawn from the pool. */
  principal: number;
  rate: 'variable' | 'fixed';
  /** APR in force. Fixed: locked at open. Variable: the pool's rate as of the last session. */
  apr: number;
  opened: string;
  /** A fixed loan ends here and repays itself; a variable loan runs until repaid. */
  expiry?: string;
  /** Interest owed through `accruedTo`, in USDC. */
  accrued: number;
  accruedTo: string;
  status: 'active' | 'closed';
  /** Interest paid over the loan's life, set at close. */
  paid?: number;
  closedBy?: 'repaid' | 'expired' | 'liquidated';
}
export interface LedgerEvent {
  id: string;
  date: string;
  timestamp: number;
  title: string;
  detail: string;
  cash: number;
  shares: number;
  /** Which underlying the share movement was in. */
  symbol?: string;
  reference?: string;
  /** Set when an agent placed the action through MCP. Not part of the
   * onchain book hash, so it never affects chain verification. */
  via?: 'agent';
}
export interface VaultBook {
  version: 3;
  date: string;
  margin: 'cross' | 'isolated';
  wallet: Balances;
  vault: Balances;
  counterparty: Balances;
  market: Balances;
  options: OptionPosition[];
  loans: LendingPosition[];
  shorts: ShortPosition[];
  borrows: BorrowPosition[];
  events: LedgerEvent[];
}
export interface CollateralGroup {
  cashMinimum: number;
  cashMaximum: number;
  key: string;
  symbol: string;
  expiry: string;
  settlement: string;
  positions: number;
  cash: number;
  shares: number;
  counterpartyCash: number;
  counterpartyShares: number;
}
/** Share figures are per underlying; cash and values are one book. */
export type PerSymbol = Record<string, number>;
export interface RiskSummary {
  cash: number;
  shares: PerSymbol;
  grossCash: number;
  grossShares: PerSymbol;
  freeCash: number;
  freeShares: PerSymbol;
  releasedValue: number;
  collateralValue: number;
  availableValue: number;
  utilization: number;
  counterpartyCash: number;
  counterpartyShares: PerSymbol;
  marketShares: PerSymbol;
  groups: CollateralGroup[];
}
export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}
export interface Quote {
  intent?: 'open' | 'close';
  positionId?: string;
  id: string;
  revision: number;
  terms: OrderTerms;
  premium: number;
  expiresAt: number;
  issuedAt: number;
  reviewDeadline?: number; // Browser monotonic time; never accepted as execution input.
  greeks: Greeks;
  cashRequired: number;
  sharesRequired: number;
  cashAfter: number;
  sharesAfter: number;
  releasedValue: number;
  eligible: boolean;
  reason?: string;
}
export interface VaultSnapshot {
  revision: number;
  csrf: string;
  book: VaultBook;
  risk: RiskSummary;
  market: {
    clock: 'daily-close-with-hourly-test-clock';
    /** The default underlying; its price and volatility are below. */
    symbol: string;
    price: number;
    date: string;
    dates: string[];
    volatility: number;
    dividend: number;
    dividendDate: string;
    /** Every underlying the desk can write on, priced at this session. */
    underlyings: MarketUnderlying[];
  };
  serverTime: number;
  mode: 'sandbox' | 'localnet' | 'devnet';
  chain?: {
    ledger: string;
    signature: string;
    slot: number;
    network: string;
    revision: number;
  };
}
export interface MarketUnderlying {
  symbol: string;
  name: string;
  provider: 'equity' | 'prestocks';
  price: number;
  volatility: number;
  simulated: boolean;
}
export type VaultAction =
  | {
      type: 'transfer';
      direction: 'deposit' | 'withdraw';
      asset: Asset;
      amount: number;
    }
  | { type: 'stock'; side: Side; quantity: number; symbol?: string }
  | { type: 'execute'; quoteId: string }
  | { type: 'margin'; mode: 'cross' | 'isolated' }
  | { type: 'lend'; quantity: number; expiry: string; symbol?: string }
  | { type: 'recall'; id: string }
  | {
      type: 'short';
      quantity: number;
      cap: number;
      expiry: string;
      symbol?: string;
    }
  | { type: 'close-short'; id: string }
  | {
      type: 'borrow';
      /** Shares pledged. */
      pledged: number;
      /** USDC drawn. */
      amount: number;
      rate: 'variable' | 'fixed';
      /** Required for a fixed rate: the session the loan repays itself on. */
      expiry?: string;
      symbol?: string;
    }
  | { type: 'repay'; id: string }
  | { type: 'advance'; date: string }
  | { type: 'restart' };

export interface ContractIndication {
  premium: number;
  cash: number;
  shares: number;
}
export interface ChainCatalog {
  revision: number;
  symbol: string;
  expiry: string;
  quantity: number;
  spot: number;
  pricing: string;
  rows: {
    strike: number;
    contracts: {
      kind: OptionKind;
      buy: ContractIndication;
      sell: ContractIndication;
      delta: number;
    }[];
  }[];
}
export interface SizeResult extends ContractIndication {
  revision: number;
  terms: OrderTerms;
  centSensitivity: number;
  cashFunding: number;
  limited: boolean;
}
