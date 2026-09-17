export type Asset = 'USDC' | 'NVDA';
export type Side = 'buy' | 'sell';
export type OptionKind = 'call' | 'put';
export interface Balances {
  USDC: number;
  NVDA: number;
}
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
export interface LedgerEvent {
  id: string;
  date: string;
  timestamp: number;
  title: string;
  detail: string;
  cash: number;
  shares: number;
  reference?: string;
}
export interface VaultBook {
  version: 2;
  date: string;
  margin: 'cross' | 'isolated';
  wallet: Balances;
  vault: Balances;
  counterparty: Balances;
  market: Balances;
  options: OptionPosition[];
  loans: LendingPosition[];
  shorts: ShortPosition[];
  events: LedgerEvent[];
}
export interface CollateralGroup {
  cashMinimum: number;
  cashMaximum: number;
  key: string;
  expiry: string;
  settlement: string;
  positions: number;
  cash: number;
  shares: number;
  counterpartyCash: number;
  counterpartyShares: number;
}
export interface RiskSummary {
  cash: number;
  shares: number;
  grossCash: number;
  grossShares: number;
  freeCash: number;
  freeShares: number;
  releasedValue: number;
  collateralValue: number;
  availableValue: number;
  utilization: number;
  counterpartyCash: number;
  counterpartyShares: number;
  marketShares: number;
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
    symbol: 'NVDA';
    price: number;
    date: string;
    dates: string[];
    volatility: number;
    dividend: number;
    dividendDate: string;
  };
  serverTime: number;
  mode: 'sandbox' | 'localnet';
  chain?: {
    ledger: string;
    signature: string;
    slot: number;
    network: string;
    revision: number;
  };
}
export type VaultAction =
  | {
      type: 'transfer';
      direction: 'deposit' | 'withdraw';
      asset: Asset;
      amount: number;
    }
  | { type: 'stock'; side: Side; quantity: number }
  | { type: 'execute'; quoteId: string }
  | { type: 'margin'; mode: 'cross' | 'isolated' }
  | { type: 'lend'; quantity: number; expiry: string }
  | { type: 'recall'; id: string }
  | { type: 'short'; quantity: number; cap: number; expiry: string }
  | { type: 'close-short'; id: string }
  | { type: 'advance'; date: string }
  | { type: 'restart' };

export interface ContractIndication {
  premium: number;
  cash: number;
  shares: number;
}
export interface ChainCatalog {
  revision: number;
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
