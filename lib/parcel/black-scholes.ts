/** Annual, continuously-compounded inputs shared by every model product. */
export interface BlackScholesModel {
  riskFreeRate: number;
  dividendYield: number;
}

/**
 * Explicit sandbox assumptions. These are model inputs, not a claim of a
 * tradeable market quote. Callers can supply a different curve without
 * changing pricing, Greeks, or fractional-share scale semantics.
 */
export const DEFAULT_BLACK_SCHOLES: BlackScholesModel = Object.freeze({
  riskFreeRate: 0.04,
  dividendYield: 0,
});

export function resolveBlackScholesModel(
  overrides: Partial<BlackScholesModel> = {},
): BlackScholesModel {
  const model: BlackScholesModel = {
    ...DEFAULT_BLACK_SCHOLES,
    ...overrides,
  };
  if (
    !Number.isFinite(model.riskFreeRate) ||
    !Number.isFinite(model.dividendYield)
  )
    throw new RangeError('Black-Scholes rates must be finite numbers.');
  return model;
}
