/**
 * Figures for the landing page.
 *
 * Every number the marketing page shows is computed here by the same
 * engine the desk uses, from the same stored history, so the page cannot
 * drift from the product. Nothing on the landing page is a literal.
 */
import { mark, expiries, VOLATILITY } from './market';
import { registry } from '../preipo/registry';
import { orderGreeks, strategyPnl, days } from './math';
import { termInterest } from './funding';
import { EXERCISE_WINDOW_DAYS } from '../preipo/terms';
import type { OrderTerms } from './types';

/** The session the desk opens on. */
export const OPEN_DATE = '2025-01-24';
export const SPOT = mark('NVDA', OPEN_DATE);

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
  symbol: 'NVDA',
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
 * The hero opens on a plain long call, not a spread.
 *
 * A spread's upside is capped by the leg you sell, so its payoff goes
 * flat and stays flat however far the stock runs. That is the right
 * shape for the structures tile, where the cap is the point, and the
 * wrong shape for the first frame of the front page: the thing this
 * product does is let you buy one share-equivalent of a contract that
 * would otherwise cost a hundred shares, and that contract's upside
 * does not stop.
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
const SAMPLE_INTERVALS = 200;

/**
 * Four major intervals make a payoff scale readable, but the values at
 * either end should be round and the zero rule must always be a real tick.
 * This is deliberately a chart-scale helper, not a pricing approximation.
 */
const niceStep = (range: number) => {
  const raw = Math.max(range / 4, 1e-6);
  const unit = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / unit;
  const multiple = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return multiple * unit;
};

/**
 * The frame every payoff on the landing page is drawn in.
 *
 * Exported because the components draw the gridlines, the zero rule and
 * the axis labels themselves, and a chart whose axis is half a
 * viewBox-unit off its own plot is the single most visible way for a
 * chart to look wrong. One set of numbers, read by everything.
 */
export const PLOT = {
  w: 760,
  h: 340,
  /** Leave room for the P&L scale; it makes the payoff readable as data. */
  x0: 58,
  x1: 746,
  /* y0 leaves a band above the plot for the strike labels */
  y0: 42,
  y1: 296,
  /** baseline the price labels sit on */
  axisY: 330,
} as const;

export interface Payoff {
  line: string;
  area: string;
  zeroY: number;
  /** The same samples the path is built from, for the morph. */
  points: [number, number][];
  strikes: { value: number; x: number }[];
  axis: string[];
  /** Price labels with the x they belong over, so they cannot drift. */
  ticks: { label: string; x: number }[];
  /** Evenly spaced P&L gridlines across the drawn range. */
  grid: { y: number; label: string }[];
  best: number;
  worst: number;
  /** Where the payoff crosses zero, in viewBox x. */
  crossings: { value: number; x: number }[];
}

/**
 * Project a contract's payoff at expiry into a 760×340 viewBox.
 *
 * Every product that has a shape gets one from here, so the previews
 * are the same arithmetic the desk runs rather than drawings of it.
 *
 * The point array comes back alongside the path because the hero
 * interpolates between two structures frame by frame, and it can only
 * do that on numbers. Every payoff here is sampled on the same 50-cent
 * price grid, including every landing-page strike, so any two of them
 * interpolate point-for-point without rounding a kink away.
 */
export function payoff(terms: OrderTerms, premium: number, stock = 0): Payoff {
  const samples = Array.from({ length: SAMPLE_INTERVALS + 1 }, (_, i) => {
    const price = LOW + ((HIGH - LOW) * i) / SAMPLE_INTERVALS;
    return { price, pnl: strategyPnl(terms, price, SPOT, premium, stock) };
  });
  const min = Math.min(...samples.map((s) => s.pnl));
  const max = Math.max(...samples.map((s) => s.pnl));
  const step = niceStep(Math.max(max, 0) - Math.min(min, 0));
  const scaleMin = Math.floor(Math.min(min, 0) / step) * step;
  const scaleMax = Math.ceil(Math.max(max, 0) / step) * step;
  const scaleSpan = scaleMax - scaleMin || step;
  const x = (price: number) =>
    PLOT.x0 + ((price - LOW) / (HIGH - LOW)) * (PLOT.x1 - PLOT.x0);
  const y = (pnl: number) =>
    PLOT.y0 + ((scaleMax - pnl) / scaleSpan) * (PLOT.y1 - PLOT.y0);
  const points = samples.map(
    (s) =>
      [Number(x(s.price).toFixed(1)), Number(y(s.pnl).toFixed(1))] as [
        number,
        number,
      ],
  );
  const line = points
    .map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`)
    .join(' ');

  // Break-even is where the sampled payoff changes sign. Interpolating
  // between the two samples either side puts the label on the real
  // crossing rather than on whichever sample happened to be nearest.
  const crossings: { value: number; x: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i];
    if (a.pnl === 0 || a.pnl < 0 === b.pnl < 0) continue;
    const t = -a.pnl / (b.pnl - a.pnl);
    const price = a.price + (b.price - a.price) * t;
    crossings.push({ value: price, x: x(price) });
  }

  // The grid is a real financial axis: readable round values, including
  // zero, with enough headroom that a capped payoff never looks cropped.
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const grid = Array.from(
    { length: Math.round(scaleSpan / step) + 1 },
    (_, i) => scaleMax - i * step,
  ).map((value) => ({
    y: y(value),
    label: usd(Math.abs(value) < step / 1_000 ? 0 : value, decimals),
  }));

  return {
    line,
    points,
    area: `${line} L${x(HIGH).toFixed(1)},${y(0).toFixed(1)} L${x(LOW).toFixed(1)},${y(0).toFixed(1)} Z`,
    zeroY: y(0),
    strikes: terms.legs.map((l) => ({ value: l.strike, x: x(l.strike) })),
    axis: [usd(LOW, 0), usd(SPOT), usd(HIGH, 0)],
    ticks: [
      { label: usd(LOW, 0), x: x(LOW) },
      { label: usd(SPOT), x: x(SPOT) },
      { label: usd(HIGH, 0), x: x(HIGH) },
    ],
    grid,
    best: max,
    worst: min,
    crossings,
  };
}

const HERO_PAYOFF = payoff(HERO_CALL, CALL_PREMIUM);
const MIN = HERO_PAYOFF.worst;

/** A long call breaks even at the strike plus what it cost. */
const BREAK_EVEN = HERO_CALL.legs[0].strike + CALL_PREMIUM / HERO_CALL.quantity;

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
};

/* ---------- the structures the hero cycles through ---------- */

/**
 * One shape per idea, priced by the engine.
 *
 * The viewer shows these one at a time, so the set is chosen for how
 * differently the lines read rather than for exhaustive coverage: a
 * line that only goes up, one that is capped, a band, and a V.
 */
export interface Structure {
  id: string;
  name: string;
  contract: string;
  blurb: string;
  payoff: Payoff;
  stats: { k: string; v: string; multiline?: boolean }[];
}

const CAP = '∞';

/**
 * The figures under every shape, in the same four slots, so the row
 * does not reflow as the hero cycles. An uncapped payoff says so
 * rather than quoting a number from the edge of the sampled window,
 * which is an artefact of where the window stops.
 */
function structureStats(
  p: Payoff,
  premium: number,
  { uncapped = false }: { uncapped?: boolean },
) {
  const netPremium =
    Math.abs(premium) < 0.005
      ? 'Even'
      : `${usd(Math.abs(premium))} ${premium > 0 ? 'debit' : 'credit'}`;

  return [
    { k: 'Net premium', v: netPremium },
    { k: 'Max loss', v: p.worst >= 0 ? 'None' : usd(-p.worst) },
    { k: 'Max gain', v: uncapped ? CAP : usd(p.best) },
    {
      k: p.crossings.length > 1 ? 'Break-evens' : 'Break-even',
      v: p.crossings.length
        ? p.crossings.map((c) => usd(c.value)).join('\n')
        : 'Any price',
      multiline: p.crossings.length > 1 || undefined,
    },
  ];
}

function structure(
  id: string,
  name: string,
  contract: string,
  blurb: string,
  order: OrderTerms,
  opts: { stock?: number; uncapped?: boolean } = {},
): Structure {
  const p = premiumOf(order);
  const shape = payoff(order, p, opts.stock || 0);
  return {
    id,
    name,
    contract,
    blurb,
    payoff: shape,
    stats: structureStats(shape, p, { uncapped: opts.uncapped }),
  };
}

export const STRUCTURES: Structure[] = [
  structure(
    'long-call',
    'Long call',
    'Buy 1 $145 call',
    'Your loss is limited to the premium. Above $145, the payoff rises dollar for dollar.',
    HERO_CALL,
    { uncapped: true },
  ),
  structure(
    'covered-call',
    'Covered call',
    'Own 1 share and sell the $150 call',
    'The premium offsets a decline. Above $150, the share is called away.',
    terms({
      name: 'NVDA covered call',
      quantity: 1,
      settlement: 'physical',
      legs: [{ kind: 'call', side: 'sell', strike: 150, ratio: 1 }],
    }),
    { stock: 1 },
  ),
  structure(
    'call-spread',
    'Call spread',
    'Buy the $145 call and sell the $160 call',
    'Your loss is limited to the premium. Profit stops increasing above $160.',
    terms({
      name: 'NVDA call spread',
      quantity: 1,
      legs: [
        { kind: 'call', side: 'buy', strike: 145, ratio: 1 },
        { kind: 'call', side: 'sell', strike: 160, ratio: 1 },
      ],
    }),
  ),
  structure(
    'collar',
    'Stock collar',
    'Own 1 share, buy the $130 put, and sell the $150 call',
    'The put sets a floor under the share, and the call helps pay for it. The position stays within that band.',
    terms({
      name: 'NVDA collar',
      quantity: 1,
      settlement: 'physical',
      legs: [
        { kind: 'put', side: 'buy', strike: 130, ratio: 1 },
        { kind: 'call', side: 'sell', strike: 150, ratio: 1 },
      ],
    }),
    { stock: 1 },
  ),
  structure(
    'straddle',
    'Long straddle',
    'Buy the $145 call and the $145 put',
    'A large move in either direction can offset the premium. It loses most when NVDA finishes near $145.',
    terms({
      name: 'NVDA straddle',
      quantity: 1,
      settlement: 'physical',
      legs: [
        { kind: 'call', side: 'buy', strike: 145, ratio: 1 },
        { kind: 'put', side: 'buy', strike: 145, ratio: 1 },
      ],
    }),
    { uncapped: true },
  ),
  structure(
    'condor',
    'Iron condor',
    'Sell the $135/$150 spread; buy protection at $125 and $160',
    'The position earns its premium between the short strikes. Losses outside the wings are capped.',
    terms({
      name: 'NVDA iron condor',
      quantity: 1,
      legs: [
        { kind: 'put', side: 'buy', strike: 125, ratio: 1 },
        { kind: 'put', side: 'sell', strike: 135, ratio: 1 },
        { kind: 'call', side: 'sell', strike: 150, ratio: 1 },
        { kind: 'call', side: 'buy', strike: 160, ratio: 1 },
      ],
    }),
  ),
];

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

/* How many of the listed mints the escrow policy refuses. PreStocks
   configures a permanent delegate, which lets the issuer move tokens
   out of an escrow account, so none of its line can back a contract.
   Counted off the registry so the figure cannot drift from it. */
const PREIPO_LISTED = registry.length;
const PREIPO_BLOCKED = registry.filter(
  (a) => a.provider === 'prestocks',
).length;

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

/**
 * One figure per product, pulled out of the table and set large.
 *
 * A reader skimming five tiles reads one number from each, so the tile
 * picks which one rather than leaving it to whichever row happens to
 * be first.
 */
export interface Pull {
  value: string;
  label: string;
}

/** How the thing is actually held together, in three facts. */
export interface Mechanic {
  title: string;
  detail: string;
}

export const EXAMPLES: {
  id: string;
  kicker: string;
  title: string;
  body: string;
  pull: Pull;
  rows: string[][];
  mechanics: Mechanic[];
  preview: Preview;
}[] = [
  {
    id: 'options',
    kicker: 'Options',
    title: 'Buy a contract the size of your position.',
    body: 'A listed contract needs a hundred shares. Size to one, or to a quarter of one.',
    pull: {
      value: usd(CALL_PREMIUM),
      label: `is the entire downside of one share-equivalent of the $${HERO_CALL.legs[0].strike} call.`,
    },
    mechanics: [
      {
        title: 'What you post',
        detail:
          'The premium, and nothing else. A physically settled buy prefunds the exercise cash on top of it, so exercise can never fail for want of money.',
      },
      {
        title: 'How it settles',
        detail:
          'Cash or physical delivery, chosen on the ticket and written into the contract. Both return to the vault the premium came out of.',
      },
      {
        title: 'What it is priced on',
        detail: `Black-Scholes at ${VOLATILITY * 100}% vol against the stored ${HERO.openLabel} close, which is the model the desk quotes on rather than a number for the page.`,
      },
    ],
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
    pull: {
      value: usd(COVERED_PREMIUM),
      label: 'received for reserving a quarter of one share until expiry.',
    },
    mechanics: [
      {
        title: 'Nothing is written naked',
        detail:
          'The shares move to reserve as part of signing the quote. A contract that cannot be covered is refused at the ticket, not at expiry.',
      },
      {
        title: 'Reserved means reserved',
        detail:
          'Reserved shares leave the spendable balance and cannot back a second contract, be lent, or be withdrawn while the call is open.',
      },
      {
        title: 'Either ending is funded',
        detail:
          'Above the strike the reserved shares deliver. At or below it they come back, and the premium was yours from the start.',
      },
    ],
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
    pull: {
      value: usd(SPREAD_PREMIUM),
      label: 'is the most a call spread can lose, and it is known at signing.',
    },
    mechanics: [
      {
        title: 'Four legs, one contract',
        detail:
          'Legs are priced, collateralized and settled together. They cannot be closed apart, because half a spread is a different position.',
      },
      {
        title: 'Offsets you can actually take',
        detail:
          'A long leg releases the short leg’s collateral only where settlement can net them. Where it cannot, the capital stays posted.',
      },
      {
        title: 'The ceiling is quoted',
        detail:
          'The written leg caps the payoff. That cap is on the ticket before you sign rather than discovered on the expiry statement.',
      },
    ],
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
    pull: {
      value: `${PREIPO_BLOCKED} of ${PREIPO_LISTED}`,
      label:
        'listed mints are refused, because their issuer can move tokens out of an escrow account.',
    },
    mechanics: [
      {
        title: 'The mint is read, not trusted',
        detail:
          'Freeze authority, permanent delegate, transfer hooks and fees are read from the chain and checked against what the registry claims.',
      },
      {
        title: 'Escrow the issuer cannot reach',
        detail:
          'Tokens move to a program escrow for the term. A mint whose issuer retains a way in is listed with its reason and cannot be written against.',
      },
      {
        title: 'Tokens, never shares',
        detail:
          'Exercise delivers the token. Quantities are denominated in tokens throughout, and holding one confers no shareholder rights.',
      },
    ],
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
    title: 'Lend stock, or borrow against it.',
    body: 'Lend your tokenized stock, or borrow against it at a variable or fixed rate. The borrower posts cash and the full term’s interest up front. Pledged protection cannot be reused.',
    pull: {
      value: usd(LOAN_COLLATERAL),
      label: `is posted in cash before a single share moves, against ${usd(SPOT)} of stock.`,
    },
    mechanics: [
      {
        title: 'Overcollateralized, in the vault',
        detail: `150% of the reference close, in cash, sitting in the vault before the loan opens — not a credit line and not a promise.`,
      },
      {
        title: 'Interest is prepaid',
        detail:
          'The whole term is paid at open. There is no accrual to chase, nothing to margin-call, and no way for the loan to quietly go underwater.',
      },
      {
        title: 'Pledged protection stays pledged',
        detail:
          'A put pledged against a loan cannot be sold, closed or reused as collateral anywhere else while the loan is open.',
      },
    ],
    rows: [
      [`Lend ${LOAN_QTY} NVDA`, dayLabel(EXPIRY)],
      ['Borrower posts', usd(LOAN_COLLATERAL)],
      [
        'Interest prepaid',
        `${usd(LOAN_INTEREST, 4)} at ${(LOAN_RATE * 100).toFixed(2)}% APR`,
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

/* ------------------------------------------------------------------
   How it works.

   Four steps, each with a figure the desk actually computes. The copy
   used to sit beside four numbered paragraphs and nothing else, which
   asked the reader to take the flow on trust; these show the screens
   the words describe, and every figure in them is priced here rather
   than typed.
   ------------------------------------------------------------------ */

/** A vault funded the way the walkthrough opens it. */
const VAULT_USDC = 10_000;
const VAULT_SHARES = 25;
const VAULT_TOTAL = VAULT_USDC + VAULT_SHARES * SPOT;

/** The premium at four sizes, so the sizing step shows the linearity. */
const SIZES = [0.25, 0.5, 1, 2].map((q) => ({
  label: `${q}×`,
  cost: usd(premiumOf({ ...HERO_CALL, quantity: q })),
  selected: q === 1,
}));

export type StepFigure =
  | {
      kind: 'balance';
      total: string;
      rows: { label: string; value: string; share: number }[];
    }
  | { kind: 'payoff'; payoff: Payoff; contract: string }
  | { kind: 'sizes'; note: string; sizes: typeof SIZES }
  | { kind: 'review'; rows: { label: string; value: string }[] };

export const WALKTHROUGH: {
  id: string;
  title: string;
  detail: string;
  figure: StepFigure;
}[] = [
  {
    id: 'fund',
    title: 'Fund a vault',
    detail:
      'Deposit USDC or shares. The balance is yours, it persists across reloads, and nothing is ever borrowed against it on your behalf.',
    figure: {
      kind: 'balance',
      total: usd(VAULT_TOTAL),
      rows: [
        {
          label: 'USDC',
          value: usd(VAULT_USDC),
          share: VAULT_USDC / VAULT_TOTAL,
        },
        {
          label: `${VAULT_SHARES} NVDA`,
          value: usd(VAULT_SHARES * SPOT),
          share: (VAULT_SHARES * SPOT) / VAULT_TOTAL,
        },
      ],
    },
  },
  {
    id: 'pick',
    title: 'Pick a position',
    detail:
      'An option, a four-leg structure, a covered call on a sponsor token, or a stock loan.',
    figure: {
      kind: 'payoff',
      payoff: HERO_PAYOFF,
      contract: `${HERO_CALL.quantity}× NVDA $${HERO_CALL.legs[0].strike} call, expiring ${dayLabel(EXPIRY)}`,
    },
  },
  {
    id: 'size',
    title: 'Size it to what you own',
    detail:
      'Share-equivalents, a premium budget, a dollar sensitivity or a share count. A listed contract starts at a hundred shares; this one starts at a millionth of one.',
    figure: {
      kind: 'sizes',
      note: `Premium for the $${HERO_CALL.legs[0].strike} call at each size.`,
      sizes: SIZES,
    },
  },
  {
    id: 'settle',
    title: 'Review, then settle',
    detail:
      'Premium, collateral and the worst case are on the ticket before you sign. Settlement returns to the same vault it was funded from.',
    figure: {
      kind: 'review',
      rows: [
        { label: 'Premium', value: usd(CALL_PREMIUM) },
        { label: 'Break-even', value: usd(BREAK_EVEN) },
        { label: 'Expiry', value: dayLabel(EXPIRY) },
        { label: 'Worst case', value: usd(MIN) },
      ],
    },
  },
];
