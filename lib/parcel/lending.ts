import { isUnderlying, nameOf } from './universe';
/**
 * The money-market model behind the lending screen.
 *
 * Rates are not quoted from a table; they are derived from the pool's
 * utilisation with the two-slope curve every major Solana and EVM money
 * market uses. Below the optimal point borrowing is cheap and the
 * slope is gentle, above it the second slope bites hard and pulls
 * liquidity back in. That is the whole reason a lending screen is worth
 * showing: the number moves because the pool moved, and the reader can
 * see which way it is being pushed.
 *
 * Risk parameters are per asset. A stablecoin can carry a far higher
 * loan-to-value than a private-company token, and the difference is
 * what makes "deposit cash, short the stock" a different trade from
 * "post a sponsor token, short the stock".
 */

export interface Reserve {
  symbol: string;
  name: string;
  /** Maximum fraction of this asset's value that can be borrowed against. */
  ltv: number;
  /** Where liquidation begins. Always above the LTV. */
  liquidation: number;
  /** The discount a liquidator takes. */
  bonus: number;
  /** Rate curve. */
  base: number;
  slope1: number;
  slope2: number;
  optimal: number;
  /** The share of borrower interest the protocol keeps. */
  reserveFactor: number;
  collateral: boolean;
  borrowable: boolean;
  /** Why this asset is parameterised the way it is. */
  note: string;
}

export const RESERVES: Reserve[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    ltv: 0.85,
    liquidation: 0.88,
    bonus: 0.04,
    base: 0,
    slope1: 0.055,
    slope2: 0.6,
    optimal: 0.9,
    reserveFactor: 0.1,
    collateral: true,
    borrowable: true,
    note: 'The settlement asset. Highest LTV, because its collateral value cannot gap.',
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    ltv: 0.7,
    liquidation: 0.75,
    bonus: 0.07,
    base: 0,
    slope1: 0.07,
    slope2: 1.4,
    optimal: 0.8,
    reserveFactor: 0.15,
    collateral: true,
    borrowable: true,
    note: 'Blue-chip crypto collateral. Deep enough to liquidate into, volatile enough to need room.',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    ltv: 0.75,
    liquidation: 0.8,
    bonus: 0.06,
    base: 0,
    slope1: 0.05,
    slope2: 1.2,
    optimal: 0.8,
    reserveFactor: 0.15,
    collateral: true,
    borrowable: true,
    note: 'The deepest collateral on the desk, and the least likely to gap through a liquidation.',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    ltv: 0.75,
    liquidation: 0.8,
    bonus: 0.06,
    base: 0,
    slope1: 0.055,
    slope2: 1.2,
    optimal: 0.8,
    reserveFactor: 0.15,
    collateral: true,
    borrowable: true,
    note: 'Blue-chip crypto collateral, parameterised alongside BTC.',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    ltv: 0.6,
    liquidation: 0.68,
    bonus: 0.09,
    base: 0.005,
    slope1: 0.09,
    slope2: 1.8,
    optimal: 0.7,
    reserveFactor: 0.2,
    collateral: true,
    borrowable: true,
    note: 'Borrowable to short. An equity gaps on an earnings print, so it borrows dearer than crypto.',
  },
];

/**
 * A private company's token, as a reserve.
 *
 * None of the tokens has a lending market of its own, so they share
 * one set of terms: thin collateral credit, a steep curve, and a wide
 * liquidation bonus, because a mark that walks on a sponsor's print
 * can gap the way an illiquid equity does.
 */
const PRIVATE: Omit<Reserve, 'symbol' | 'name'> = {
  ltv: 0.4,
  liquidation: 0.5,
  bonus: 0.12,
  base: 0.01,
  slope1: 0.12,
  slope2: 2.5,
  optimal: 0.6,
  reserveFactor: 0.25,
  collateral: true,
  borrowable: true,
  note: 'A private mark: thin credit, dear to borrow, and a wide bonus for whoever takes it over.',
};
export const reserveOf = (symbol: string): Reserve | null =>
  RESERVES.find((r) => r.symbol === symbol) ||
  (isUnderlying(symbol) ? { symbol, name: nameOf(symbol), ...PRIVATE } : null);

/**
 * The two-slope curve.
 *
 * Supply yield is borrower interest, scaled by how much of the pool is
 * actually lent out and net of the reserve factor — which is why a pool
 * at 20% utilisation pays its suppliers almost nothing however high the
 * borrow rate looks.
 */
export function rates(utilisation: number, r: Reserve) {
  const u = Math.min(1, Math.max(0, utilisation));
  const borrow =
    u <= r.optimal
      ? r.base + (u / r.optimal) * r.slope1
      : r.base + r.slope1 + ((u - r.optimal) / (1 - r.optimal)) * r.slope2;
  const supply = borrow * u * (1 - r.reserveFactor);
  return { borrow, supply, utilisation: u };
}

export interface Holding {
  symbol: string;
  /** Units held, not dollars. */
  amount: number;
  price: number;
}

/**
 * Aave's health factor: weighted collateral over debt.
 *
 * Below 1 the position is liquidatable. Infinity means no debt, which
 * the UI has to special-case rather than print.
 */
export function health(collateral: Holding[], debt: Holding[]) {
  const weighted = collateral.reduce((t, h) => {
    const r = reserveOf(h.symbol);
    return t + (r ? h.amount * h.price * r.liquidation : 0);
  }, 0);
  const owed = debt.reduce((t, h) => t + h.amount * h.price, 0);
  const supplied = collateral.reduce((t, h) => t + h.amount * h.price, 0);
  const borrowPower = collateral.reduce((t, h) => {
    const r = reserveOf(h.symbol);
    return t + (r ? h.amount * h.price * r.ltv : 0);
  }, 0);
  return {
    factor: owed > 0 ? weighted / owed : Infinity,
    supplied,
    owed,
    borrowPower,
    available: Math.max(0, borrowPower - owed),
    /** Loan to value actually used, as a fraction of the limit. */
    used: borrowPower > 0 ? Math.min(1, owed / borrowPower) : 0,
  };
}

/** How a health factor should read to someone glancing at it. */
export function healthTone(factor: number) {
  if (!Number.isFinite(factor)) return 'safe' as const;
  if (factor >= 1.8) return 'safe' as const;
  if (factor >= 1.25) return 'watch' as const;
  return 'risk' as const;
}

/**
 * The price at which a short is liquidated.
 *
 * Solving weighted collateral = shorted units × price for price. A
 * short's debt grows as the stock rises, so this is the level the
 * borrower is watching, and it is the single most useful number on the
 * screen.
 */
export function liquidationPrice(
  weightedCollateral: number,
  shortedUnits: number,
  otherDebt = 0,
) {
  if (shortedUnits <= 0) return null;
  const headroom = weightedCollateral - otherDebt;
  return headroom > 0 ? headroom / shortedUnits : 0;
}

/**
 * Where the ledger reads the curve when no pool is watching.
 *
 * The live engine seeds its pools between 42% and 66% out, so a loan
 * priced without it lands in the same band rather than at zero, where
 * every asset borrows for nothing.
 */
export const RESTING_UTILISATION = 0.5;

/** The pool's borrow APR for an asset, off its own curve, to a millionth. */
export function borrowRate(symbol: string, utilisation: number | null) {
  const r = reserveOf(symbol);
  if (!r) throw Error('Choose a supported underlying.');
  return Math.round(rates(utilisation ?? RESTING_UTILISATION, r).borrow * 1e6) / 1e6;
}

/** The most that can be drawn against a pledge, at the asset's loan-to-value. */
export function borrowLimit(pledged: number, price: number, r: Reserve) {
  return Math.floor(pledged * price * r.ltv * 1e6) / 1e6;
}

/**
 * The price at which a cash loan's pledge stops covering it.
 *
 * Solving pledged × price × liquidation threshold = debt for price.
 * The debt is cash, so unlike a short it does not move with the stock;
 * only the cover does, and this is the level it runs out at.
 */
export function pledgeLiquidationPrice(debt: number, pledged: number, r: Reserve) {
  if (pledged <= 0 || debt <= 0) return null;
  return debt / (pledged * r.liquidation);
}
