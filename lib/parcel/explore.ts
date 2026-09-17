import type { OrderTerms, VaultSnapshot } from './types';
import { templateTerms } from './templates';
import { expiries } from './market';
import { deliveryBounds } from './envelope';
import { orderGreeks, round } from './math';
import { parseOrderTerms } from './validation';

export const exploreGoals = [
  {
    id: 'upside',
    title: 'Explore the upside',
    subtitle: 'Give a price move a defined range.',
    template: 'call-spread',
    page: 'Structures',
    tag: 'CALL SPREAD',
    tone: 'blue',
    tradeoff:
      'Upside stops at the upper strike. If the stock stays below the lower strike, the premium can be lost.',
  },
  {
    id: 'protect',
    title: 'Protect my shares',
    subtitle: 'See what a floor can change.',
    template: 'put',
    page: 'Trade',
    tag: 'PROTECTIVE PUT',
    tone: 'peach',
    tradeoff:
      'Protection costs a premium. Stock losses above the put strike still belong to you; the chart includes the stock.',
  },
  {
    id: 'premium',
    title: 'Explore premium income',
    subtitle: 'See the trade-off for capping upside.',
    template: 'covered-call',
    page: 'Underwrite',
    tag: 'COVERED CALL',
    tone: 'mint',
    tradeoff:
      'Premium does not erase stock losses. Above the strike, you deliver the shares and give up further upside.',
  },
] as const;
export type ExploreGoal = (typeof exploreGoals)[number];
export interface ExploreDraft {
  templateId: string;
  terms: OrderTerms;
}

// Consumer presets use the same validated terms and model math as the desk.
// They are illustrations, not quotes; execution always requests a funded quote.
export function explorePreview(
  goal: ExploreGoal,
  quantity: number,
  state: VaultSnapshot,
) {
  const dates = expiries(state.book.date);
  const target = Date.parse(state.book.date) + 14 * 86400000;
  const expiry = dates.find((d) => Date.parse(d) >= target) || dates.at(-1);
  if (!expiry) return null;
  const spot = state.market.price;
  const middle = Math.max(5, Math.round(spot / 5) * 5);
  const terms = templateTerms(goal.template, expiry);
  terms.quantity = quantity;
  terms.legs =
    goal.id === 'upside'
      ? [
          { kind: 'call', side: 'buy', strike: middle, ratio: 1 },
          { kind: 'call', side: 'sell', strike: middle + 10, ratio: 1 },
        ]
      : [
          {
            kind: goal.id === 'protect' ? 'put' : 'call',
            side: goal.id === 'protect' ? 'buy' : 'sell',
            strike: goal.id === 'protect' ? middle : middle + 5,
            ratio: 1,
          },
        ];
  parseOrderTerms(terms, state.book.date);
  const premium = round(
    orderGreeks(terms, spot, state.book.date, state.market.volatility).price,
  );
  const backing = deliveryBounds([terms]);
  const cash = Number(backing.cashMin < 0n ? -backing.cashMin : 0n) / 1e6;
  const shares = Number(backing.sharesMin < 0n ? -backing.sharesMin : 0n) / 1e6;
  return {
    terms,
    premium,
    cash,
    shares,
    stockQuantity: goal.id === 'upside' ? 0 : quantity,
  };
}
