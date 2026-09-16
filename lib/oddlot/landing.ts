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

export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

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

/* ---------- the hero preview: a quarter-share call spread ---------- */

export const SPREAD = terms({
  name: 'NVDA call spread',
  quantity: 0.25,
  legs: [
    { kind: 'call', side: 'buy', strike: 145, ratio: 1 },
    { kind: 'call', side: 'sell', strike: 160, ratio: 1 },
  ],
});
const SPREAD_PREMIUM = premiumOf(SPREAD);

const LOW = 95,
  HIGH = 195;
const pnlAt = (price: number) =>
  strategyPnl(SPREAD, price, SPOT, SPREAD_PREMIUM, 0);

const SAMPLES = Array.from({ length: 81 }, (_, i) => {
  const price = LOW + ((HIGH - LOW) * i) / 80;
  return { price, pnl: pnlAt(price) };
});
const MIN = Math.min(...SAMPLES.map((s) => s.pnl));
const MAX = Math.max(...SAMPLES.map((s) => s.pnl));

/** Map the computed payoff into the hero card's 760×240 viewBox. */
const X = (price: number) => 40 + ((price - LOW) / (HIGH - LOW)) * 680;
const Y = (pnl: number) => 32 + ((MAX - pnl) / (MAX - MIN || 1)) * 168;

export const HERO = {
  title: SPREAD.name,
  spotLabel: usd(SPOT),
  openLabel: dayLabel(OPEN_DATE),
  expiry: EXPIRY,
  expiryLabel: dayLabel(EXPIRY),
  dte: Math.round(days(OPEN_DATE, EXPIRY)),
  strikes: SPREAD.legs.map((l) => l.strike),
  // The middle mark is the reference close, not a round number that
  // would collide with a strike label.
  axis: [usd(LOW, 0), usd(SPOT), usd(HIGH, 0)],
  zeroY: Y(0),
  strikeX: SPREAD.legs.map((l) => X(l.strike)),
  line: SAMPLES.map(
    (s, i) => `${i ? 'L' : 'M'}${X(s.price).toFixed(1)},${Y(s.pnl).toFixed(1)}`,
  ).join(' '),
  area: `${SAMPLES.map((s, i) => `${i ? 'L' : 'M'}${X(s.price).toFixed(1)},${Y(s.pnl).toFixed(1)}`).join(' ')} L${X(HIGH).toFixed(1)},${Y(0).toFixed(1)} L${X(LOW).toFixed(1)},${Y(0).toFixed(1)} Z`,
  stats: [
    { k: 'Premium', v: usd(SPREAD_PREMIUM) },
    { k: 'Size', v: '¼ share' },
    { k: 'Max gain', v: usd(MAX) },
    {
      k: 'Expiry',
      v: `${dayLabel(EXPIRY)} · ${Math.round(days(OPEN_DATE, EXPIRY))}d`,
    },
  ],
};

/* ---------- one worked example per product ---------- */

const CALL = terms({
  quantity: 1,
  settlement: 'physical',
  legs: [{ kind: 'call', side: 'buy', strike: 145, ratio: 1 }],
});
const CALL_PREMIUM = premiumOf(CALL);

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

export const EXAMPLES = [
  {
    id: 'options',
    kicker: 'Options',
    title: 'Buy a contract the size of your position.',
    body: 'A listed contract needs a hundred shares. Size to one, or to a quarter of one.',
    rows: [
      [
        'Buy 1× NVDA $145 call',
        `${dayLabel(EXPIRY)} · ${Math.round(days(OPEN_DATE, EXPIRY))}d`,
      ],
      ['Premium', usd(CALL_PREMIUM)],
      ['Cash to fund exercise', usd(145 * 1 + CALL_PREMIUM)],
    ],
  },
  {
    id: 'underwriting',
    kicker: 'Underwriting',
    title: 'Write the other side, fully collateralized.',
    body: 'Deposit a share, write a call against it. The reserve is visible before you sign.',
    rows: [
      [
        'Sell ¼× NVDA $150 call',
        `${dayLabel(EXPIRY)} · ${Math.round(days(OPEN_DATE, EXPIRY))}d`,
      ],
      ['Premium received', usd(COVERED_PREMIUM)],
      ['Shares reserved', '0.25 NVDA'],
    ],
  },
  {
    id: 'structures',
    kicker: 'Structures',
    title: 'Spreads, collars and capped curves.',
    body: 'Up to four legs under one collateral rule. Offsets release capital only when settlement allows.',
    rows: [
      [
        '¼× $145/$160 call spread',
        `${dayLabel(EXPIRY)} · ${Math.round(days(OPEN_DATE, EXPIRY))}d`,
      ],
      ['Premium', usd(SPREAD_PREMIUM)],
      ['Most it can pay', usd(MAX)],
    ],
  },
  {
    id: 'pre-ipo',
    kicker: 'Pre-IPO',
    title: 'Covered calls on sponsor tokens.',
    body: 'Every mint is read on chain first. A token the issuer can move out of escrow cannot back a contract.',
    rows: [
      ['Escrow', `${PREIPO.tokens} T-OpenAI · ${EXERCISE_WINDOW_DAYS}d`],
      [
        `If exercised above $${(PREIPO.exercise / PREIPO.tokens).toLocaleString('en-US')}`,
        `${(PREIPO.premium + PREIPO.exercise).toFixed(2)} USDC`,
      ],
      ['If it expires', `${PREIPO.premium.toFixed(2)} USDC`],
    ],
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
  },
];
