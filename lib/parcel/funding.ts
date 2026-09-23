import { units } from '../engine';
import { add, days, mul, optionGreeks, round } from './math';
import type { BorrowPosition, ShortPosition } from './types';

// Shared display/execution amounts. Only stored market dates feed these functions.
export function termInterest(
  quantity: number,
  entry: number,
  from: string,
  to: string,
) {
  const elapsed = BigInt(Date.parse(to) - Date.parse(from));
  const denominator = 365_000n * 86_400_000n;
  return (
    Number(
      (units(mul(quantity, entry)) * 35n * elapsed + denominator / 2n) /
        denominator,
    ) / 1e6
  );
}
export function accruedInterest(
  prepaid: number,
  opened: string,
  expiry: string,
  at: string,
) {
  const term = BigInt(Date.parse(expiry) - Date.parse(opened));
  const elapsed = BigInt(
    Math.min(Date.parse(expiry), Math.max(Date.parse(opened), Date.parse(at))) -
      Date.parse(opened),
  );
  if (term <= 0n) throw Error('Interest requires a positive term.');
  return Number((units(prepaid) * elapsed + term / 2n) / term) / 1e6;
}
export function protectionPremium(
  quantity: number,
  entry: number,
  cap: number,
  from: string,
  to: string,
  volatility = 0.45,
) {
  return round(
    optionGreeks('call', entry, cap, days(from, to), volatility).price *
      quantity,
  );
}
export function shortCloseAmounts(p: ShortPosition, spot: number, at: string) {
  const repurchase = mul(p.quantity, Math.min(spot, p.cap));
  const interest = accruedInterest(p.maxInterest, p.opened, p.expiry, at);
  return {
    repurchase,
    interest,
    total: add(repurchase, interest),
    pnl: add(
      add(add(mul(p.quantity, p.entry), -repurchase), -interest),
      -p.premium,
    ),
  };
}

/**
 * Simple interest on a cash loan, in six-decimal USDC.
 *
 * Same shape as termInterest, with the rate as an input rather than
 * the fixed 3.5% the stock loans use: a cash loan is priced off the
 * pool's curve, and a variable one is repriced every session.
 */
export function borrowInterest(
  principal: number,
  apr: number,
  from: string,
  to: string,
) {
  const elapsed = BigInt(Math.max(0, Date.parse(to) - Date.parse(from)));
  const rate = BigInt(Math.round(apr * 1e6));
  const denominator = 1_000_000n * 365n * 86_400_000n;
  return (
    Number(
      (units(principal) * rate * elapsed + denominator / 2n) / denominator,
    ) / 1e6
  );
}
/** What a cash loan owes as of a session: interest booked so far plus the run since. */
export function borrowDebt(p: BorrowPosition, at: string) {
  const through = p.expiry && p.expiry < at ? p.expiry : at;
  const interest = add(
    p.accrued,
    borrowInterest(p.principal, p.apr, p.accruedTo, through),
  );
  return { interest, total: add(p.principal, interest) };
}
