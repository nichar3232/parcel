/**
 * Figures for the landing page.
 *
 * Every number the marketing page shows is computed here by the same
 * engine the desk uses, from the same stored history, so the page cannot
 * drift from the product. Nothing on the landing page is a literal.
 */
import { mark, expiries, VOLATILITY } from './market';
import { orderGreeks, strategyPnl, days } from './math';
import { termInterest } from './funding';
import { EXERCISE_WINDOW_DAYS } from '../preipo/terms';
import type { OrderTerms } from './types';

/** The session the desk opens on. */
export const OPEN_DATE = '2025-01-24';
export const SPOT = mark(OPEN_DATE);

const EXPIRIES = expiries(OPEN_DATE);
/** Two weeks out, which is what the desk preselects. */
export const EXPIRY = EXPIRIES.find((d) => days(OPEN_DATE, d) >= 14) as string;

const usd = (n: number, d = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

export { expiryLabel as dayLabel } from './format';
import { expiryLabel as dayLabel } from './format';

const terms = (
  over: Partial<OrderTerms> & Pick<OrderTerms, 'legs'>,
): OrderTerms => ({
  name: 'example',
  quantity: 1,
  expiry: EXPIRY,
  settlement: 'cash',
  reference: 'stock',
  ...over,
});

const premiumOf = (t: OrderTerms) =>
  orderGreeks(t, SPOT, OPEN_DATE, VOLATILITY).price;

/* ---------- the hero preview: one share-equivalent call ---------- */

/**
 * The hero shows a plain long call, not a spread.
 *
 * A spread's upside is capped by the leg you sell, so its payoff goes
 * flat and stays flat however far the stock runs. That is the right
 * shape for the structures tile, where the cap is the point, and the
 * wrong shape for the front page: the thing this product does is let
 * you buy one share-equivalent of a contract that would otherwise cost
 * a hundred shares, and that contract's upside does not stop.
 */
export const HERO_CALL = terms({
  name: 'NVDA call',
  quantity: 1,
  settlement: 'physical',
  legs: [{ kind: 'call', side: 'buy', strike: 145, ratio: 1 }],
});
const CALL_PREMIUM = premiumOf(HERO_CALL);

// The same window the desk's own payoff chart draws: spot ±35%.
const LOW = Math.round(SPOT * 0.65),
  HIGH = Math.round(SPOT * 1.35);

export interface Payoff {
  line: string;
  area: string;
  zeroY: number;
  strikes: { value: number; x: number }[];
  axis: string[];
  best: number;
  worst: number;
}

/**
 * Project a contract's payoff at expiry into a 760×240 viewBox.
 *
 * Every product that has a shape gets one from here, so the previews
 * are the same arithmetic the desk runs rather than drawings of it.
 */
export function payoff(terms: OrderTerms, premium: number, stock = 0): Payoff {
  const samples = Array.from({ length: 81 }, (_, i) => {
    const price = LOW + ((HIGH - LOW) * i) / 80;
    return { price, pnl: strategyPnl(terms, price, SPOT, premium, stock) };
  });
  const min = Math.min(...samples.map((s) => s.pnl));
  const max = Math.max(...samples.map((s) => s.pnl));
  const x = (price: number) => 40 + ((price - LOW) / (HIGH - LOW)) * 680;
  const y = (pnl: number) => 32 + ((max - pnl) / (max - min || 1)) * 168;
  const line = samples
    .map(
      (s, i) =>
        `${i ? 'L' : 'M'}${x(s.price).toFixed(1)},${y(s.pnl).toFixed(1)}`,
    )
    .join(' ');
  return {
    line,
    area: `${line} L${x(HIGH).toFixed(1)},${y(0).toFixed(1)} L${x(LOW).toFixed(1)},${y(0).toFixed(1)} Z`,
    zeroY: y(0),
    strikes: terms.legs.map((l) => ({ value: l.strike, x: x(l.strike) })),
    axis: [usd(LOW, 0), usd(SPOT), usd(HIGH, 0)],
    best: max,
    worst: min,
  };
}

const HERO_PAYOFF = payoff(HERO_CALL, CALL_PREMIUM);
const MIN = HERO_PAYOFF.worst;

/** A long call breaks even at the strike plus what it cost. */
const BREAK_EVEN = HERO_CALL.legs[0].strike + CALL_PREMIUM / HERO_CALL.quantity;

/**
 * The front-page ticket permits a reader to inspect the exact same call at
 * common fractional sizes. These are model indications only; the desk still
 * issues an owner-bound quote before an action can be confirmed.
 */
const HERO_SIZES = [0.25, 0.5, 1] as const;

export const HERO = {
  title: HERO_CALL.name,
  contract: `${HERO_CALL.quantity}× $${HERO_CALL.legs[0].strike} call`,
  spotLabel: usd(SPOT),
  openLabel: dayLabel(OPEN_DATE),
  expiry: EXPIRY,
  expiryLabel: dayLabel(EXPIRY),
  dte: Math.round(days(OPEN_DATE, EXPIRY)),
  strikes: HERO_CALL.legs.map((l) => l.strike),
  axis: HERO_PAYOFF.axis,
  zeroY: HERO_PAYOFF.zeroY,
  strikeX: HERO_PAYOFF.strikes.map((k) => k.x),
  line: HERO_PAYOFF.line,
  area: HERO_PAYOFF.area,
  // On a long call the premium is the whole downside, and the upside
  // has no ceiling to quote, so the card quotes neither a best case nor
  // a cap it does not have.
  stats: [
    { k: 'Size', v: '1 share' },
    { k: 'Max loss', v: usd(-MIN) },
    { k: 'Break-even', v: usd(BREAK_EVEN) },
    { k: 'Expiry', v: dayLabel(EXPIRY) },
  ],
  breakEven: usd(BREAK_EVEN),
  sizes: HERO_SIZES.map((quantity) => ({
    quantity,
    label: `${quantity.toFixed(2)} share${quantity === 1 ? '' : 's'}`,
    premium: usd(CALL_PREMIUM * quantity),
    exerciseCash: usd((HERO_CALL.legs[0].strike + CALL_PREMIUM) * quantity),
  })),
};

/* ---------- one worked example per product ---------- */

const SPREAD = terms({
  name: 'NVDA call spread',
  quantity: 0.25,
  legs: [
    { kind: 'call', side: 'buy', strike: 145, ratio: 1 },
    { kind: 'call', side: 'sell', strike: 160, ratio: 1 },
  ],
});
const SPREAD_PREMIUM = premiumOf(SPREAD);
/** Selling the 160 leg caps the payoff at the width of the spread. */
const SPREAD_CAP =
  (SPREAD.legs[1].strike - SPREAD.legs[0].strike) * SPREAD.quantity -
  SPREAD_PREMIUM;

const COVERED = terms({
  quantity: 0.25,
  settlement: 'physical',
  legs: [{ kind: 'call', side: 'sell', strike: 150, ratio: 1 }],
});
const COVERED_PREMIUM = Math.abs(premiumOf(COVERED));

const LOAN_QTY = 1;
const LOAN_RATE = 0.035;
const LOAN_COLLATERAL = LOAN_QTY * SPOT * 1.5;
const LOAN_INTEREST = termInterest(LOAN_QTY, SPOT, OPEN_DATE, EXPIRY);

/** Pre-IPO covered call, priced by the same totals the contract stores. */
const PREIPO = { tokens: 0.25, premium: 6.5, exercise: 225 };

/**
 * A covered call written in the opening session expires one exercise
 * window later, so the tile can name the date like every other product
 * rather than describing the window.
 */
export const PREIPO_EXPIRY = new Date(
  Date.parse(`${OPEN_DATE}T12:00:00Z`) + EXERCISE_WINDOW_DAYS * 86_400_000,
)
  .toISOString()
  .slice(0, 10);

/**
 * Each product carries a preview: the shape it makes, or the two ways
 * it can end, or how its collateral divides. All of it computed.
 */
export type Preview =
  | { kind: 'payoff'; payoff: Payoff; caption: string }
  | {
      kind: 'outcomes';
      caption: string;
      outcomes: { when: string; value: string; note: string }[];
    }
  | {
      kind: 'split';
      caption: string;
      parts: { label: string; value: string; share: number }[];
    };

const COVERED_PAYOFF = payoff(COVERED, premiumOf(COVERED), COVERED.quantity);
const SPREAD_PAYOFF = payoff(SPREAD, SPREAD_PREMIUM);

export const EXAMPLES: {
  id: string;
  kicker: string;
  title: string;
  body: string;
  rows: string[][];
  preview: Preview;
}[] = [
  {
    id: 'options',
    kicker: 'Options',
    title: 'Buy a contract the size of your position.',
    body: 'A listed contract needs a hundred shares. Size to one, or to a quarter of one.',
    rows: [
      ['Buy 1× NVDA $145 call', dayLabel(EXPIRY)],
      ['Premium', usd(CALL_PREMIUM)],
      ['Cash to fund exercise', usd(145 * 1 + CALL_PREMIUM)],
    ],
    preview: {
      kind: 'payoff',
      payoff: HERO_PAYOFF,
      caption:
        'Loses the premium and nothing more; above the strike it keeps paying.',
    },
  },
  {
    id: 'underwriting',
    kicker: 'Underwriting',
    title: 'Write the other side, fully collateralized.',
    body: 'Deposit a share, write a call against it. The reserve is visible before you sign.',
    rows: [
      ['Sell ¼× NVDA $150 call', dayLabel(EXPIRY)],
      ['Premium received', usd(COVERED_PREMIUM)],
      ['Shares reserved', '0.25 NVDA'],
    ],
    preview: {
      kind: 'payoff',
      payoff: COVERED_PAYOFF,
      caption:
        'The premium cushions the downside and the call caps the gain above the strike.',
    },
  },
  {
    id: 'structures',
    kicker: 'Structures',
    title: 'Spreads, collars and capped curves.',
    body: 'Up to four legs under one collateral rule. Offsets release capital only when settlement allows.',
    rows: [
      ['¼× $145/$160 call spread', dayLabel(EXPIRY)],
      ['Premium, and the most you can lose', usd(SPREAD_PREMIUM)],
      ['Upside capped above $160', usd(SPREAD_CAP)],
    ],
    preview: {
      kind: 'payoff',
      payoff: SPREAD_PAYOFF,
      caption: 'Bounded at both ends: a known cost against a known ceiling.',
    },
  },
  {
    id: 'pre-ipo',
    kicker: 'Pre-IPO',
    title: 'Covered calls on sponsor tokens.',
    body: 'Every mint is read on chain first. A token the issuer can move out of escrow cannot back a contract.',
    rows: [
      ['Escrow 0.25 T-OpenAI', dayLabel(PREIPO_EXPIRY)],
      [
        `If exercised above $${(PREIPO.exercise / PREIPO.tokens).toLocaleString('en-US')}`,
        `${(PREIPO.premium + PREIPO.exercise).toFixed(2)} USDC`,
      ],
      ['If it expires', `${PREIPO.premium.toFixed(2)} USDC`],
    ],
    preview: {
      kind: 'outcomes',
      caption: 'Two ways it ends, both known before you sign.',
      outcomes: [
        {
          when: `Above $${(PREIPO.exercise / PREIPO.tokens).toLocaleString('en-US')}`,
          value: `${(PREIPO.premium + PREIPO.exercise).toFixed(2)} USDC`,
          note: `You deliver ${PREIPO.tokens} T-OpenAI.`,
        },
        {
          when: 'At or below',
          value: `${PREIPO.premium.toFixed(2)} USDC`,
          note: `You keep the premium and the ${PREIPO.tokens} T-OpenAI.`,
        },
      ],
    },
  },
  {
    id: 'lending',
    kicker: 'Lending',
    title: 'Lend stock against funded collateral.',
    body: 'The borrower posts cash and the full term’s interest up front. Pledged protection cannot be reused.',
    rows: [
      ['Lend', `${LOAN_QTY} NVDA · ${dayLabel(EXPIRY)}`],
      ['Borrower posts', usd(LOAN_COLLATERAL)],
      [
        'Interest prepaid',
        `${usd(LOAN_INTEREST, 4)} · ${(LOAN_RATE * 100).toFixed(2)}% APR`,
      ],
    ],
    preview: {
      kind: 'split',
      caption: 'What the borrower posts before a share moves.',
      parts: [
        {
          label: 'Stock lent, at the reference close',
          value: usd(SPOT),
          share: 1,
        },
        {
          label: 'Cash collateral posted',
          value: usd(LOAN_COLLATERAL),
          share: LOAN_COLLATERAL / SPOT,
        },
      ],
    },
  },
];
