import { units } from '../engine';
import { add, days, mul, optionGreeks, round } from './math';
import type { ShortPosition } from './types';

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
) {
  return round(
    optionGreeks('call', entry, cap, days(from, to)).price * quantity,
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
