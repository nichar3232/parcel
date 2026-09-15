import type { Leg, OrderTerms } from './types';
const leg = (
  kind: 'call' | 'put',
  side: 'buy' | 'sell',
  strike: number,
  ratio = 1,
): Leg => ({ kind, side, strike, ratio });
export const templates: {
  id: string;
  name: string;
  tag: string;
  description: string;
  legs: Leg[];
  settlement: 'cash' | 'physical';
  reference: 'stock' | 'dividend';
}[] = [
  {
    id: 'call',
    name: 'Long call',
    tag: 'UPSIDE',
    description: 'The right to buy one share at a fixed strike.',
    legs: [leg('call', 'buy', 145)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'put',
    name: 'Protective put',
    tag: 'DOWNSIDE',
    description: 'The right to sell a deposited share at a fixed strike.',
    legs: [leg('put', 'buy', 140)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'covered-call',
    name: 'Covered call',
    tag: 'UNDERWRITE',
    description: 'Receive premium against shares you already hold.',
    legs: [leg('call', 'sell', 150)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'secured-put',
    name: 'Cash-secured put',
    tag: 'UNDERWRITE',
    description: 'Receive premium against a fully funded stock purchase.',
    legs: [leg('put', 'sell', 130)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'call-spread',
    name: 'Call spread',
    tag: 'DEFINED UPSIDE',
    description: 'Buy upside exposure within an explicit price range.',
    legs: [leg('call', 'buy', 140), leg('call', 'sell', 150)],
    settlement: 'cash',
    reference: 'stock',
  },
  {
    id: 'put-spread',
    name: 'Put spread',
    tag: 'DEFINED DOWNSIDE',
    description: 'Protect a chosen band of downside, share by share.',
    legs: [leg('put', 'buy', 140), leg('put', 'sell', 130)],
    settlement: 'cash',
    reference: 'stock',
  },
  {
    id: 'straddle',
    name: 'Long straddle',
    tag: 'VOLATILITY',
    description: 'Own a call and a put at the same strike.',
    legs: [leg('call', 'buy', 140), leg('put', 'buy', 140)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'strangle',
    name: 'Long strangle',
    tag: 'VOLATILITY',
    description: 'Position for a larger move in either direction.',
    legs: [leg('call', 'buy', 150), leg('put', 'buy', 130)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'condor',
    name: 'Iron condor',
    tag: 'RANGE',
    description: 'Underwrite a range with both tails explicitly capped.',
    legs: [
      leg('put', 'buy', 120),
      leg('put', 'sell', 130),
      leg('call', 'sell', 150),
      leg('call', 'buy', 160),
    ],
    settlement: 'cash',
    reference: 'stock',
  },
  {
    id: 'butterfly',
    name: 'Call butterfly',
    tag: 'VOLATILITY',
    description: 'Define a concentrated payoff around your target.',
    legs: [
      leg('call', 'buy', 130),
      leg('call', 'sell', 140, 2),
      leg('call', 'buy', 150),
    ],
    settlement: 'cash',
    reference: 'stock',
  },
  {
    id: 'collar',
    name: 'Stock collar',
    tag: 'CAPITAL PROTECTION',
    description: 'Combine a protective put with a covered call.',
    legs: [leg('put', 'buy', 130), leg('call', 'sell', 150)],
    settlement: 'physical',
    reference: 'stock',
  },
  {
    id: 'dividend',
    name: 'Dividend call spread',
    tag: 'DIVIDEND EVENT',
    description: 'A capped cash claim on the declared dividend per share.',
    legs: [leg('call', 'buy', 0.005), leg('call', 'sell', 0.015)],
    settlement: 'cash',
    reference: 'dividend',
  },
];
export function templateTerms(id: string, expiry: string): OrderTerms {
  const t = templates.find((t) => t.id === id) || templates[0];
  return {
    name: t.name,
    legs: structuredClone(t.legs),
    quantity: 1,
    expiry: t.reference === 'dividend' ? '2025-03-12' : expiry,
    settlement: t.settlement,
    reference: t.reference,
  };
}
