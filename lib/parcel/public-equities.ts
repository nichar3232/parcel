/**
 * The public-equity universe shown in the portfolio watchlist.
 *
 * This is deliberately a small, liquid group rather than an implied claim
 * that Parcel has a complete equities terminal. Every symbol has a Pyth feed
 * identifier, a conservative model volatility, and a fallback seed so the
 * quote service can state exactly when it is modelling a mark instead of
 * receiving one from a venue.
 */
export interface PublicEquity {
  symbol: string;
  name: string;
  pyth: string;
  vol: number;
  seed: number;
  spreadBps: number;
  depth: number;
}

export const PUBLIC_EQUITIES: PublicEquity[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    pyth: 'Equity.US.NVDA/USD',
    vol: 0.45,
    seed: 142.62,
    spreadBps: 6,
    depth: 24_000_000,
  },
  {
    symbol: 'AAPL',
    name: 'Apple',
    pyth: 'Equity.US.AAPL/USD',
    vol: 0.28,
    seed: 230,
    spreadBps: 4,
    depth: 31_000_000,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    pyth: 'Equity.US.MSFT/USD',
    vol: 0.29,
    seed: 510,
    spreadBps: 4,
    depth: 29_000_000,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon',
    pyth: 'Equity.US.AMZN/USD',
    vol: 0.37,
    seed: 225,
    spreadBps: 5,
    depth: 26_000_000,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet',
    pyth: 'Equity.US.GOOGL/USD',
    vol: 0.31,
    seed: 245,
    spreadBps: 4,
    depth: 25_000_000,
  },
  {
    symbol: 'META',
    name: 'Meta',
    pyth: 'Equity.US.META/USD',
    vol: 0.39,
    seed: 760,
    spreadBps: 5,
    depth: 22_000_000,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla',
    pyth: 'Equity.US.TSLA/USD',
    vol: 0.54,
    seed: 430,
    spreadBps: 7,
    depth: 20_000_000,
  },
];
