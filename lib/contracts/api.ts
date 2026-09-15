import type { Action, Book, Status, Terms } from '../engine';
export interface SessionPortfolio {
  book: Book;
  revision: number;
  serverTime: number;
  csrf: string;
  sessionExpiresAt: number;
}
export interface TransactionRecord {
  label: string;
  signature: string;
  slot?: number | null;
  status?: 'prepared' | 'submitted' | 'confirmed' | 'failed';
}
export interface ChainPosition {
  id: string;
  network: 'localnet' | 'devnet';
  programId: string;
  mint: string;
  holder: string;
  maker: string;
  offer: string;
  vault: string;
  market: string;
  terms: Terms;
  nonce: string;
  expiry: number;
  chainTime?: number;
  deadline: number;
  historicalAt: number;
  price: number;
  transactions: TransactionRecord[];
  status: Status | 'prepared';
  buyerPayout: number;
  buyerClaimed: boolean;
  makerClaimed: boolean;
  escrow: number;
  lastSlot: number;
  updatedAt: string;
  pending?: boolean;
  warning?: string;
  operationId?: string;
}
export interface ChainEvidence {
  network: 'localnet' | 'devnet';
  programId: string;
  mint: string;
  holder: string;
  maker: string;
  completedAt: string;
  transactions: TransactionRecord[];
  checks: string[];
  stockHolding?: { mint: string; quantity: number; symbol: string };
  dataset: string;
}
export interface Health {
  ok: boolean;
  app: 'strata';
  database: 'ready' | 'unavailable';
  chain: {
    ready: boolean;
    network: 'localnet' | 'devnet';
    reason?: string;
    slot?: number;
    chainTime?: number;
  };
  serverTime: number;
}
export type ChainAction =
  | 'fund'
  | 'accept'
  | 'cancel'
  | 'settle'
  | 'claim-holder'
  | 'claim-maker';
export type PortfolioAction = Action;
export interface ApiErrorBody {
  error: string;
  code: string;
  requestId?: string;
  portfolio?: SessionPortfolio;
  position?: ChainPosition;
}
