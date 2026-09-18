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
  curve?: OrderTerms['curve'];
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
templates.push(
  {
    id: 'quadratic',
    name: 'Capped quadratic',
    tag: 'CONVEXITY',
    description:
      'A smooth squared payoff inside a chosen range, with a fixed cash cap.',
    legs: [],
    settlement: 'cash',
    reference: 'stock',
    curve: {
      shape: 'quadratic',
      side: 'buy',
      direction: 'up',
      lower: 130,
      upper: 160,
      cap: 10,
    },
  },
  {
    id: 'exponential',
    name: 'Capped exponential',
    tag: 'CONVEXITY',
    description: 'An accelerating payoff, fully capped before you enter.',
    legs: [],
    settlement: 'cash',
    reference: 'stock',
    curve: {
      shape: 'exponential',
      side: 'buy',
      direction: 'up',
      lower: 130,
      upper: 160,
      cap: 10,
    },
  },
  {
    id: 'box',
    name: 'Fixed payout box',
    tag: 'CASH FLOW',
    description:
      'Four cash-settled legs lock a fixed expiry receipt. Earlier receipts can back later obligations.',
    legs: [
      leg('call', 'buy', 130),
      leg('call', 'sell', 140),
      leg('put', 'buy', 140),
      leg('put', 'sell', 130),
    ],
    settlement: 'cash',
    reference: 'stock',
  },
  {
    id: 'dividend-floor',
    name: 'Dividend floor spread',
    tag: 'DIVIDEND EVENT',
    description:
      'A bounded payoff when the declared dividend falls below your chosen band.',
    legs: [leg('put', 'buy', 0.015), leg('put', 'sell', 0.005)],
    settlement: 'cash',
    reference: 'dividend',
  },
  {
    id: 'dividend-range',
    name: 'Dividend range',
    tag: 'DIVIDEND EVENT',
    description: 'A capped butterfly centered on the declared cash dividend.',
    legs: [
      leg('call', 'buy', 0.005),
      leg('call', 'sell', 0.01, 2),
      leg('call', 'buy', 0.015),
    ],
    settlement: 'cash',
    reference: 'dividend',
  },
  {
    id: 'dividend-curve',
    name: 'Dividend convexity',
    tag: 'DIVIDEND EVENT',
    description:
      'Capped quadratic participation in the dividend event, with optional underwriting.',
    legs: [],
    settlement: 'cash',
    reference: 'dividend',
    curve: {
      shape: 'quadratic',
      side: 'buy',
      direction: 'up',
      lower: 0.005,
      upper: 0.015,
      cap: 0.01,
    },
  },
);
export function templateTerms(id: string, expiry: string): OrderTerms {
  const t = templates.find((t) => t.id === id) || templates[0];
  return {
    ...(t.curve ? { curve: structuredClone(t.curve) } : {}),
    name: t.name,
    legs: structuredClone(t.legs),
    quantity: 1,
    expiry: t.reference === 'dividend' ? '2025-03-12' : expiry,
    settlement: t.settlement,
    reference: t.reference,
  };
}

/**
 * The structure families, and which templates belong to each.
 *
 * Declared here rather than as a filter inside the view, because the
 * rail names the families and the screen lists their members: two
 * readings of one fact, which have to agree.
 */
export const CATEGORIES = [
  'Direction',
  'Volatility',
  'Convexity',
  'Dividends',
  'Cash flow',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function templatesIn(category: Category) {
  return templates.filter((t) =>
    category === 'Dividends'
      ? t.reference === 'dividend'
      : category === 'Convexity'
        ? !!t.curve
        : category === 'Cash flow'
          ? t.id === 'box'
          : category === 'Volatility'
            ? ['straddle', 'strangle', 'condor', 'butterfly'].includes(t.id)
            : ['call-spread', 'put-spread', 'collar'].includes(t.id),
  );
}

/** The four single contracts the options ticket writes. */
export const CONTRACTS = ['call', 'put', 'covered-call', 'secured-put'];
