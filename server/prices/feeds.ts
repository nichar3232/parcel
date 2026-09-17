/**
 * The instruments the desk quotes, and where their marks come from.
 *
 * Pyth publishes crypto around the clock and US equities only while the
 * cash market is open, and nobody publishes a pre-IPO sponsor token at
 * all. So every instrument carries the volatility to walk it with when
 * no fresh observation exists, and the engine is honest in the payload
 * about which of the two the reader is looking at.
 *
 * Feed ids are resolved from Hermes by symbol at boot rather than
 * pasted in here. A hardcoded id that is subtly wrong produces a
 * plausible price for the wrong instrument, which is the worst failure
 * available; a lookup that fails just leaves the instrument simulated
 * and says so.
 */

export type Kind = 'equity' | 'crypto' | 'stable' | 'private';

export interface Instrument {
  symbol: string;
  name: string;
  kind: Kind;
  /** The Pyth symbol to resolve, when one exists. */
  pyth?: string;
  /** The Coinbase product id, for the keyless crypto fallback. */
  coinbase?: string;
  /** Annualised volatility, used to walk the mark and to price options. */
  vol: number;
  /** Seed mark, for the first tick before any feed answers. */
  seed: number;
  /** Half-spread a maker quotes around the mark, in basis points. */
  spreadBps: number;
  /** Money-market depth, in dollars. Units are derived from the mark. */
  depth: number;
}

export const INSTRUMENTS: Instrument[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    kind: 'equity',
    pyth: 'Equity.US.NVDA/USD',
    vol: 0.45,
    seed: 142.62,
    spreadBps: 6,
    depth: 24_000_000,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    kind: 'crypto',
    pyth: 'Crypto.SOL/USD',
    coinbase: 'SOL-USD',
    vol: 0.82,
    seed: 168,
    spreadBps: 8,
    depth: 70_000_000,
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    kind: 'crypto',
    pyth: 'Crypto.BTC/USD',
    coinbase: 'BTC-USD',
    vol: 0.5,
    seed: 68000,
    spreadBps: 4,
    depth: 180_000_000,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    kind: 'crypto',
    pyth: 'Crypto.ETH/USD',
    coinbase: 'ETH-USD',
    vol: 0.6,
    seed: 3400,
    spreadBps: 5,
    depth: 120_000_000,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    kind: 'stable',
    pyth: 'Crypto.USDC/USD',
    coinbase: 'USDC-USD',
    vol: 0.01,
    seed: 1,
    spreadBps: 1,
    depth: 260_000_000,
  },
];

export const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
