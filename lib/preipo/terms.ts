/**
 * Covered-call terms.
 *
 * Every economic quantity is an integer in base units. The contract stores
 * TOTAL amounts; the per-token strike shown in the interface is derived for
 * display only and is never the settlement figure. This is deliberate: a
 * per-token strike would have to be rounded, and rounding a per-unit price
 * and multiplying back does not reproduce the total the buyer must pay.
 */

export const USDC_DECIMALS = 6;

/**
 * How long an offer stays open, and how long the buyer may exercise.
 * The interface and the landing page both read these, so what the page
 * advertises is what the contract is built with.
 */
export const ACCEPTANCE_WINDOW_DAYS = 1;
export const EXERCISE_WINDOW_DAYS = 7;
const DAY = 86_400;
export const ACCEPTANCE_WINDOW_SECONDS = ACCEPTANCE_WINDOW_DAYS * DAY;
export const EXERCISE_WINDOW_SECONDS = EXERCISE_WINDOW_DAYS * DAY;
export const U64_MAX = (1n << 64n) - 1n;

export interface CoveredCallTerms {
  /** Underlying token mint (base58). */
  underlyingMint: string;
  /** USDC mint (base58). */
  usdcMint: string;
  /** Exact underlying quantity escrowed, in underlying base units. */
  underlyingAmount: bigint;
  /** Exact TOTAL exercise payment, in USDC base units. */
  totalExercisePayment: bigint;
  /** Exact TOTAL premium, in USDC base units. */
  totalPremium: bigint;
  /** Unix seconds; the offer cannot be accepted after this. */
  acceptanceDeadline: number;
  /** Unix seconds; exercise must happen strictly before this. */
  exerciseExpiry: number;
  /** Optional designated buyer (base58); anyone may accept when null. */
  designatedBuyer: string | null;
}

export class TermsError extends Error {}

function requireU64(value: bigint, field: string) {
  if (value <= 0n) throw new TermsError(`${field} must be greater than zero.`);
  if (value > U64_MAX) throw new TermsError(`${field} exceeds u64 range.`);
}

/**
 * Validate terms the way the program does, so the interface cannot offer
 * something the chain will reject.
 */
export function validateTerms(t: CoveredCallTerms): CoveredCallTerms {
  requireU64(t.underlyingAmount, 'Underlying amount');
  requireU64(t.totalExercisePayment, 'Total exercise payment');
  if (t.totalPremium <= 0n)
    throw new TermsError('Total premium must be greater than zero.');
  if (t.totalPremium > U64_MAX)
    throw new TermsError('Total premium exceeds u64 range.');

  if (t.underlyingMint === t.usdcMint)
    throw new TermsError('Underlying and USDC mints must differ.');

  if (!Number.isInteger(t.acceptanceDeadline) || t.acceptanceDeadline <= 0)
    throw new TermsError('Acceptance deadline must be a unix timestamp.');
  if (!Number.isInteger(t.exerciseExpiry) || t.exerciseExpiry <= 0)
    throw new TermsError('Exercise expiry must be a unix timestamp.');

  // The brief's rule: acceptance must close no later than exercise expiry,
  // otherwise a buyer could accept a contract they can never exercise.
  if (t.acceptanceDeadline > t.exerciseExpiry)
    throw new TermsError(
      'Acceptance deadline must be on or before the exercise expiry.',
    );
  return t;
}

/**
 * Per-token strike for display, as a decimal string.
 *
 * Derived from the totals: strike = totalExercisePayment / underlyingTokens,
 * where underlyingTokens = underlyingAmount / 10^underlyingDecimals. Computed
 * in integers and rounded only at the final digit, so it is a faithful
 * rendering of the stored totals rather than an independent number.
 */
export function displayStrike(
  totalExercisePayment: bigint,
  underlyingAmount: bigint,
  underlyingDecimals: number,
  displayDecimals = USDC_DECIMALS,
): string {
  if (underlyingAmount <= 0n)
    throw new TermsError('Underlying amount must be greater than zero.');
  // strike_per_token = total / (amount / 10^d) = total * 10^d / amount,
  // then scaled to `displayDecimals` fixed-point with half-up rounding.
  const scale = 10n ** BigInt(underlyingDecimals);
  const out = 10n ** BigInt(displayDecimals);
  const numerator = totalExercisePayment * scale * out;
  const scaled = (numerator + underlyingAmount / 2n) / underlyingAmount;
  return formatFixed(scaled, displayDecimals + USDC_DECIMALS);
}

/** Render a fixed-point bigint with `decimals` fractional digits. */
export function formatFixed(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Parse a decimal string into base units without touching floating point. */
export function parseUnits(input: string, decimals: number): bigint {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text))
    throw new TermsError(`"${input}" is not a positive decimal number.`);
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals)
    throw new TermsError(
      `At most ${decimals} decimal places are supported for this token.`,
    );
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

/** The economics a confirmation dialog must state plainly. */
export interface TermsSummary {
  underlyingAmount: string;
  totalPremium: string;
  totalExercisePayment: string;
  derivedStrikePerToken: string;
  sellerKeepsIfUnexercised: string;
  sellerReceivesIfExercised: string;
  buyerMaxLoss: string;
}

export function summarise(
  t: CoveredCallTerms,
  underlyingDecimals: number,
): TermsSummary {
  return {
    underlyingAmount: formatFixed(t.underlyingAmount, underlyingDecimals),
    totalPremium: formatFixed(t.totalPremium, USDC_DECIMALS),
    totalExercisePayment: formatFixed(t.totalExercisePayment, USDC_DECIMALS),
    derivedStrikePerToken: displayStrike(
      t.totalExercisePayment,
      t.underlyingAmount,
      underlyingDecimals,
    ),
    // The seller has already been paid the premium at acceptance.
    sellerKeepsIfUnexercised: formatFixed(t.totalPremium, USDC_DECIMALS),
    sellerReceivesIfExercised: formatFixed(
      t.totalPremium + t.totalExercisePayment,
      USDC_DECIMALS,
    ),
    // A buyer who never exercises loses exactly the premium paid.
    buyerMaxLoss: formatFixed(t.totalPremium, USDC_DECIMALS),
  };
}
