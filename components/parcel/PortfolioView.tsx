'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import { shortSignature, txLink } from '@/lib/parcel/format';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import { orderGreeks } from '@/lib/parcel/math';
import {
  accruedInterest,
  borrowDebt,
  shortCloseAmounts,
} from '@/lib/parcel/funding';
import {
  RANGES,
  valueSeries,
  withinRange,
  type Range,
} from '@/lib/parcel/value';
import { QuoteReview } from './QuoteReview';
import type { MarketUnderlying, Quote, VaultAction } from '@/lib/parcel/types';
import { AssetLogo } from './AssetLogo';
import { logoOf } from '@/lib/preipo/registry';
import {
  LiveValueChart,
  Meter,
  type MarketSessions,
  type ValueTick,
} from './charts';
import { WatchlistView } from './WatchlistView';
import type { Transfer } from './TransferDialog';
import {
  Badge,
  Button,
  Empty,
  Line,
  Modal,
  Money,
  Panel,
  PanelHead,
  dateLabel,
  expiryLabel,
  isLiveMark,
  markOf,
  qty,
  usd,
} from './shared';

export type PortfolioTab =
  | 'overview'
  | 'watchlist'
  | 'positions'
  | 'collateral'
  | 'activity';

const EMPTY_UNDERLYINGS: MarketUnderlying[] = [];

/**
 * The portfolio.
 *
 * This was one scrolling page carrying the vault, the allocation, the
 * asset table, three promo cards, the whole activity ledger, the
 * collateral policy, the settlement groups, the requirement breakdown
 * and a reconcile button. Four tabs now, each answering one question:
 * what am I worth, what do I hold, what is pledged, what happened.
 */
export function PortfolioView({
  desk,
  feed,
  tab,
  navigate,
  onTransfer,
}: {
  desk: VaultController;
  feed: MarkFeed;
  tab: PortfolioTab;
  navigate: (
    page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending',
    to?: string,
    pick?: string,
  ) => void;
  onTransfer: (t: Transfer) => void;
}) {
  const s = desk.state!;
  const { book, market } = s;
  // A receipt can survive an application deploy. Keep every portfolio
  // calculation total if an older response has not yet gained its catalog.
  const underlyings = market.underlyings ?? EMPTY_UNDERLYINGS;
  const heldSymbols = underlyings
    .filter((u) => (book.vault[u.symbol] ?? 0) > 0)
    .map((u) => u.symbol);

  /* The ledger's session price is the source of the stored balance
     history. The headline is deliberately different: once the mark feed
     is ready it is the cash in the vault plus the shares at their most
     recent observable mark. This keeps a live quote from rewriting a
     past close, while still making the number a desk user sees now react
     to the market. */
  const liveClock = market.clock === 'live';
  const liveSpots = useMemo(
    () =>
      Object.fromEntries(
        underlyings.map((u) => [
          u.symbol,
          (liveClock ? feed.marks[u.symbol]?.price : undefined) ?? u.price,
        ]),
      ),
    [feed.marks, underlyings, liveClock],
  );
  const nav = underlyings.reduce(
    (t, u) => t + (book.vault[u.symbol] ?? 0) * u.price,
    book.vault.USDC,
  );
  const liveNav = underlyings.reduce(
    (t, u) => t + (book.vault[u.symbol] ?? 0) * liveSpots[u.symbol],
    book.vault.USDC,
  );
  // The vault is live only when each held market-priced asset has a fresh
  // execution-grade mark. One fresh crypto feed must not make a stale equity
  // sleeve look current in the combined portfolio headline.
  const hasLiveMark =
    heldSymbols.length > 0 &&
    heldSymbols.every((symbol) => isLiveMark(markOf(s, feed, symbol)));
  const lastObservedAt = Math.max(
    0,
    ...heldSymbols.map((symbol) => markOf(s, feed, symbol)?.observedAt ?? 0),
  );
  // The most recent official mark remains more useful than a boot/session
  // seed even when the provider is delayed or currently stale. Its status is
  // shown beside the figure; only its ability to extend the "live" tail is
  // withheld below.
  const displayedNav = lastObservedAt ? liveNav : nav;
  // What is held: every underlying with something in the vault, NVDA
  // always so the list never comes up empty. What sits only in the
  // wallet is deposited from the wallet, not listed here as a zero.
  const held = underlyings.filter(
    (u) => u.symbol === 'NVDA' || (book.vault[u.symbol] ?? 0) > 0,
  );
  const active = book.options.filter((p) => p.status === 'active');

  /**
   * Mark every open contract to the model at the current session price.
   *
   * The desk knew what each position cost and never showed what it was
   * worth, so a book of four contracts had no P&L anywhere in the
   * product.
   */
  const marked = useMemo(
    () =>
      active.map((p) => {
        const on =
          underlyings.find((u) => u.symbol === p.terms.symbol) ??
          underlyings[0];
        const value = orderGreeks(
          p.terms,
          p.terms.reference === 'dividend'
            ? market.dividend
            : (liveSpots[p.terms.symbol] ?? on?.price ?? market.price),
          book.date,
          p.terms.reference === 'dividend'
            ? 0.8
            : (on?.volatility ?? market.volatility),
        ).price;
        // A contract opened this session marks at what it cost. Left
        // alone, floating point turns that into +$0.000000, which reads
        // as a number rather than as "nothing has happened yet".
        const drift = value - p.premium;
        return { position: p, value, pnl: Math.abs(drift) < 5e-7 ? 0 : drift };
      }),
    [active, market, book.date, underlyings, liveSpots],
  );
  const [range, setRange] = useState<'1D' | Range>('1D');
  const [scrub, setScrub] = useState<ValueTick | null>(null);
  const dailyCloses = useDailyCloses(liveClock ? heldSymbols : []);
  const series = useMemo(
    () =>
      valueSeries(
        book,
        liveClock ? { closes: dailyCloses, spot: liveSpots } : undefined,
      ),
    [book, liveClock, dailyCloses, liveSpots],
  );
  const drawn = withinRange(series, range === '1D' ? 'ALL' : range);
  const liveSamples = useLiveValueSamples(
    feed,
    displayedNav,
    s.revision,
    hasLiveMark,
    heldSymbols,
  );

  /* Today, from real prints. Every listed stock in the vault is valued at
     each of today's one-minute bars, everything else at its live mark,
     plus the cash. The feed's own ticks carry the line on past the last
     bar, so between minutes it still moves with every print. */
  const heldEquities = heldSymbols.filter(
    (symbol) => markOf(s, feed, symbol)?.kind === 'equity',
  );
  const intraday = useIntraday(heldEquities);
  const today = useMemo(() => {
    const days = intraday.filter((d) => d.bars.length);
    if (!days.length) return null;
    /* Today alone, unless today is still under an hour and a half old —
       the first minutes of a pre-market squeezed onto a full-day axis
       are a vertical scribble, so until then yesterday's session leads
       into it, the way a broker's 1D view does before the open. */
    const dayStart = Math.max(...days.map((d) => d.dayStart ?? 0));
    const lastPrint = Math.max(...days.map((d) => d.bars.at(-1)!.t));
    const todayOnly = dayStart > 0 && lastPrint - dayStart >= 90 * 60_000;
    const from = todayOnly ? dayStart : 0;
    let fixed = book.vault.USDC;
    for (const u of underlyings)
      if (!days.some((d) => d.symbol === u.symbol))
        fixed += (book.vault[u.symbol] ?? 0) * liveSpots[u.symbol];
    const times = [
      ...new Set(
        days.flatMap((d) => d.bars.filter((b) => b.t >= from).map((b) => b.t)),
      ),
    ].sort((a, b) => a - b);
    if (!times.length) return null;
    const cursor = days.map(() => 0);
    const points: ValueTick[] = times.map((t) => {
      let value = fixed;
      days.forEach((d, k) => {
        while (cursor[k] + 1 < d.bars.length && d.bars[cursor[k] + 1].t <= t)
          cursor[k]++;
        value += (book.vault[d.symbol] ?? 0) * d.bars[cursor[k]].price;
      });
      return { t, value };
    });
    const lastBar = points.at(-1)!.t;
    for (const sample of liveSamples) {
      const t = Date.parse(sample.date);
      if (t > lastBar) points.push({ t, value: sample.value });
    }
    const base = days.every((d) => d.previousClose != null)
      ? days.reduce(
          (v, d) => v + (book.vault[d.symbol] ?? 0) * d.previousClose!,
          fixed,
        )
      : null;
    /* On a time axis within one day, so the line grows toward the
       close. Across two days the overnight has no prints, so the axis is
       the prints themselves. */
    const lastObservation = points.at(-1)!.t;
    /* A current execution-grade mark is plotted across the full trading
       day (pre through after-hours). A last-mark view ends at its last
       real observation instead: reserving the rest of the session made
       a stale chart look unfinished and implied a time axis it could
       not support. */
    const sessionEnd = Math.max(
      0,
      ...days.map((d) => d.session?.end ?? 0),
      ...days.map((d) => d.post?.end ?? 0),
    );
    const end = hasLiveMark
      ? Math.max(lastObservation, sessionEnd)
      : lastObservation;
    const primary = days.find((d) => d.session) ?? days[0];
    const sessions: MarketSessions | null =
      todayOnly && primary?.session
        ? {
            pre: primary.pre,
            regular: primary.session,
            post: primary.post,
          }
        : null;
    return {
      points: todayOnly ? points : points.map((p, i) => ({ ...p, t: i })),
      times: points.map((p) => p.t),
      base,
      domain: todayOnly ? ([points[0].t, end] as [number, number]) : undefined,
      sessions,
    };
  }, [intraday, book.vault, underlyings, liveSpots, liveSamples, hasLiveMark]);

  /* The longer ranges are session-close accounting, with this browser
     session's live marks as their tail. Nothing is invented to fill them. */
  /* A range is daily closes ending on the value right now: one point for
     the present, not the second-by-second tail the 1D line draws, which
     would crowd out the days. */
  const history = useMemo(() => {
    const base = drawn.length ? drawn : [{ date: book.date, value: nav }];
    const now = liveSamples.at(-1);
    return [...base, ...(now ? [now] : [])].map((p, i) => ({
      t: i,
      value: p.value,
    }));
  }, [book.date, drawn, liveSamples, nav]);
  const historyDates = [
    ...(drawn.length ? drawn : [{ date: book.date }]).map((p) => p.date),
    ...(liveSamples.length ? ['now'] : []),
  ];

  const onDay = range === '1D' && !!today;
  const chart = onDay ? today!.points : history;
  const reference = onDay
    ? (today!.base ?? today!.points[0].value)
    : chart[0].value;
  const shown = scrub?.value ?? displayedNav;
  const moveAmount = shown - reference;
  const directionalMove =
    Math.abs(moveAmount) >= 0.005
      ? {
          amount: moveAmount,
          percent: reference ? moveAmount / reference : 0,
        }
      : null;
  const clock = (t: number) =>
    new Intl.DateTimeFormat('en-US', {
      ...(new Date(t).toDateString() !== new Date(feed.asOf).toDateString()
        ? { weekday: 'short' }
        : {}),
      hour: 'numeric',
      minute: '2-digit',
      ...(t > feed.asOf - 90_000 ? { second: '2-digit' } : {}),
    }).format(t);

  if (tab === 'watchlist') return <WatchlistView />;
  if (tab === 'collateral') return <Collateral desk={desk} />;
  if (tab === 'activity') return <Activity desk={desk} />;

  /**
   * Holdings: what you have, and what is open against it.
   *
   * This screen used to carry a donut of the same three figures printed
   * above it, a price history of one ticker, and a payoff curve summing
   * a book that is usually one contract long — three pictures that were
   * there because the space was. What a reader comes here for is the
   * balance and the list, so the screen is the balance and the list.
   *
   * "Positions" was a second tab showing the same open contracts, and
   * "Collateral" a third showing what the reserved column already says.
   * Positions is folded in below; the collateral policy is a setting,
   * reached from the line that states it.
   */
  return (
    <div className="od-open">
      <div className="od-open-main">
        <div className="od-open-head">
          <span>Vault value</span>
          <strong>
            <Money value={shown} />
          </strong>
          {directionalMove ? (
            <div
              className={`od-open-move ${directionalMove.amount >= 0 ? 'up' : 'down'}`}
            >
              {directionalMove.amount >= 0 ? (
                <TrendingUp size={15} />
              ) : (
                <TrendingDown size={15} />
              )}
              <b>
                <Money value={directionalMove.amount} sign />
              </b>
              <span>({(directionalMove.percent * 100).toFixed(2)}%)</span>
              <em>
                {scrub && onDay
                  ? clock(today!.domain ? scrub.t : today!.times[scrub.t])
                  : scrub
                    ? historyDates[scrub.t] === 'now'
                      ? 'Now'
                      : expiryLabel(historyDates[scrub.t] ?? '')
                    : onDay
                      ? 'Today'
                      : drawn.length > 1
                        ? RANGES.find((r) => r.id === range)?.label
                        : 'Since open'}
              </em>
            </div>
          ) : (
            <div className="od-open-move flat">
              Unchanged {onDay ? 'today' : 'over this range'}. Open contracts
              are marked separately below.
            </div>
          )}
          <div className={`od-open-feed ${hasLiveMark ? 'live' : ''}`}>
            <i aria-hidden />
            <span>{hasLiveMark ? 'Live' : 'Last mark'}</span>
            {lastObservedAt > 0 && (
              <time
                dateTime={new Date(
                  hasLiveMark ? feed.asOf : lastObservedAt,
                ).toISOString()}
              >
                {hasLiveMark ? clock(feed.asOf) : clock(lastObservedAt)}
              </time>
            )}
          </div>
        </div>

        <LiveValueChart
          points={chart}
          domain={onDay ? today!.domain : undefined}
          baseline={onDay ? today!.base : null}
          sessions={onDay ? today!.sessions : null}
          asOf={
            onDay
              ? scrub && today!.domain
                ? scrub.t
                : scrub
                  ? today!.times[scrub.t]
                  : feed.asOf
              : undefined
          }
          dates={onDay ? undefined : historyDates}
          range={range}
          live={hasLiveMark}
          onScrub={setScrub}
          label={`Portfolio balance`}
        />
        <div className="od-range">
          {[{ id: '1D' as const, label: '1D' }, ...RANGES].map((r) => (
            <button
              key={r.id}
              className={range === r.id ? 'active' : ''}
              aria-pressed={range === r.id}
              disabled={r.id === '1D' ? !today : series.length < 2}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <Positions
          marked={marked}
          desk={desk}
          feed={feed}
          held={held}
          navigate={navigate}
          liveSpots={liveSpots}
          onTransfer={onTransfer}
        />

        <Collateral desk={desk} />
      </div>
    </div>
  );
}

interface IntradayDay {
  symbol: string;
  previousClose: number | null;
  bars: { t: number; price: number }[];
  dayStart: number | null;
  session: { start: number; end: number } | null;
  pre?: { start: number; end: number } | null;
  post?: { start: number; end: number } | null;
}

/** "NVDA $232.50 call" for a single option; the structure's name otherwise. */
function contractTitle(terms: import('@/lib/parcel/types').OrderTerms) {
  const [leg] = terms.legs;
  if (terms.legs.length !== 1 || terms.curve) return terms.name;
  const strike = usd(leg.strike, leg.strike % 1 === 0 ? 0 : 2);
  return `${leg.side === 'sell' ? 'Short ' : ''}${terms.symbol} ${strike} ${leg.kind}`;
}

const NO_CLOSES: Record<string, { date: string; close: number }[]> = {};

/** Recent daily closes for listed stocks, from the live market. */
function useDailyCloses(symbols: string[]) {
  const key = symbols.join(',');
  const [closes, setCloses] = useState<
    Record<string, { date: string; close: number }[]>
  >({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(
      key.split(',').map(async (symbol) => {
        const res = await fetch(`/api/marks/daily?symbol=${symbol}`);
        if (!res.ok) return [symbol, []] as const;
        const body = (await res.json()) as {
          closes: { date: string; close: number }[];
        };
        return [symbol, body.closes ?? []] as const;
      }),
    )
      .then((rows) => {
        if (alive) setCloses(Object.fromEntries(rows));
      })
      .catch(() => {
        /* the longer ranges wait for the next load */
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return key ? closes : NO_CLOSES;
}

/** Today's one-minute prints for the listed stocks in the vault. */
function useIntraday(symbols: string[]) {
  const key = symbols.join(',');
  const [days, setDays] = useState<IntradayDay[]>([]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/marks/intraday?symbols=${key}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { days: IntradayDay[] };
        if (alive) setDays(body.days ?? []);
      } catch {
        /* the live tail still draws without the day's bars */
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);
  return key ? days : [];
}

/**
 * Keep only actual marks received in this browser session. A quote
 * refresh can be flat; that is still a useful observation, and it makes
 * the chart's cadence match the feed rather than an animation timer.
 */
function useLiveValueSamples(
  feed: MarkFeed,
  value: number,
  revision: number,
  hasLiveMark: boolean,
  symbols: string[],
) {
  const [samples, setSamples] = useState<{ date: string; value: number }[]>([]);
  const lastObservation = useRef(0);
  const lastRevision = useRef(revision);

  useEffect(() => {
    /* A deposit, exercise or close changes the number being charted.
       Previous browser-session samples belonged to the prior balance,
       so begin a fresh live tail at the new balance. */
    if (lastRevision.current !== revision) {
      lastRevision.current = revision;
      lastObservation.current = 0;
      setSamples([]);
    }
    // `asOf` advances with the server's heartbeat. It is not a quote. Only
    // append when an actual, fresh provider observation moves forward; this
    // prevents a broken feed from drawing a horizontal "live" tail.
    const observedAt = Math.max(
      0,
      ...feed.list
        .filter(
          (mark) =>
            symbols.includes(mark.symbol) &&
            !mark.stale &&
            mark.source !== 'simulated',
        )
        .map((mark) => mark.observedAt ?? 0),
    );
    if (!feed.ready || !hasLiveMark || !observedAt || !Number.isFinite(value))
      return;
    if (observedAt <= lastObservation.current) return;
    lastObservation.current = observedAt;
    const point = { date: new Date(observedAt).toISOString(), value };
    setSamples((previous) => [...previous.slice(-599), point]);
  }, [feed.list, feed.ready, hasLiveMark, revision, symbols, value]);

  return samples;
}

/* ---------------------------------------------------------------- */

function Positions({
  marked,
  desk,
  feed,
  held,
  navigate,
  liveSpots,
  onTransfer,
}: {
  marked: {
    position: import('@/lib/parcel/types').OptionPosition;
    value: number;
    pnl: number;
  }[];
  desk: VaultController;
  feed: MarkFeed;
  held: { symbol: string; name: string }[];
  navigate: (
    page: 'Portfolio' | 'Trade' | 'Pre-IPO' | 'Lending',
    to?: string,
  ) => void;
  liveSpots: Record<string, number>;
  onTransfer: (t: Transfer) => void;
}) {
  const s = desk.state!;
  const loans = s.book.loans.filter((p) => p.status === 'active');
  const shorts = s.book.shorts.filter((p) => p.status === 'active');
  const borrows = (s.book.borrows ?? []).filter((p) => p.status === 'active');

  /**
   * Closing a loan or a short.
   *
   * These actions used to live on a Lending → Positions tab that listed
   * the same two tables as this one. The tab is gone; the actions came
   * with it, because a position you can see and cannot close is worse
   * than one you cannot see.
   */
  // Closing an option. The button used to sit in a copy of this table
  // on the trade screen, beside the ticket that builds new ones; the
  // table is gone from there, so the action came here with it.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requesting, setRequesting] = useState(false);
  const executeClose = async () => {
    if (quote && (await desk.act({ type: 'execute', quoteId: quote.id })))
      setQuote(null);
  };

  const [review, setReview] = useState<{
    action: VaultAction;
    title: string;
    label: string;
    value: number;
    details: [string, string][];
  } | null>(null);
  const confirm = async () => {
    if (review && (await desk.act(review.action, s.revision))) setReview(null);
  };

  const book = s.book;
  const spot = (symbol: string) => liveSpots[symbol] ?? s.market.price;
  const pnlText = (n: number, dp = 2) =>
    Math.abs(n) < 0.005 && dp === 2
      ? usd(0)
      : `${n > 0 ? '+' : ''}${usd(n, dp)}`;
  const tone = (n: number) =>
    n > 0.004 ? 'od-up' : n < -0.004 ? 'od-down' : '';
  const openCount =
    marked.length + loans.length + borrows.length + shorts.length;

  /**
   * One table, the way a brokerage lists a portfolio.
   *
   * This was five boxed panels — stock, contracts, loans, borrows,
   * shorts — each with its own count badge and its own "nothing here"
   * line, so a vault holding one share read as a grid of empty states.
   * Every row now has the same five columns whatever it is: what, what
   * kind, what it is worth, what it has made, and the one thing you can
   * do with it. A category with nothing in it has no row.
   */
  return (
    <section className="od-positions" aria-labelledby="positions-title">
      <div className="od-positions-head">
        <div className="od-positions-title">
          <h2 id="positions-title">Positions</h2>
        </div>
        <span>{openCount ? `${openCount} open` : 'Cash & stock'}</span>
      </div>

      <div className="od-ptable">
        <div className="od-ptable-row od-ptable-cols">
          <span>Asset</span>
          <span>Type</span>
          <span>Value</span>
          <span>Return</span>
          <span />
        </div>

        {held.map((u) => {
          const shares = book.vault[u.symbol] ?? 0;
          const live = markOf(s, feed, u.symbol);
          const today = live ? shares * (live.price - live.open) : 0;
          const reserved = s.risk.shares[u.symbol] ?? 0;
          return (
            <div key={u.symbol} className="od-ptable-row">
              <div className="od-ptable-asset">
                <AssetLogo symbol={u.symbol} src={logoOf(u.symbol)} size={24} />
                <div>
                  <b>{u.name}</b>
                  <small>
                    {qty(shares)} {u.symbol}
                    {reserved > 0 ? `, ${qty(reserved)} reserved` : ''}
                  </small>
                </div>
              </div>
              <span className="od-ptable-type">Stock</span>
              <div className="od-ptable-num">
                <b>{usd(shares * spot(u.symbol))}</b>
                <small>{usd(spot(u.symbol))} per share</small>
              </div>
              <div className="od-ptable-num">
                <b className={tone(today)}>{pnlText(today)}</b>
                <small className={tone(live?.change ?? 0)}>
                  {live
                    ? `${live.change >= 0 ? '+' : ''}${(live.change * 100).toFixed(2)}% today`
                    : 'Session mark'}
                </small>
              </div>
              <div className="od-ptable-act">
                <button
                  onClick={() =>
                    onTransfer({ asset: u.symbol, direction: 'deposit' })
                  }
                  aria-label={`Deposit ${u.symbol}`}
                  title="Deposit"
                >
                  <ArrowDownLeft size={15} />
                </button>
                <button
                  onClick={() =>
                    onTransfer({ asset: u.symbol, direction: 'withdraw' })
                  }
                  aria-label={`Withdraw ${u.symbol}`}
                  title="Withdraw"
                >
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          );
        })}

        {marked.map(({ position: p, value, pnl }) => {
          const dp = p.terms.reference === 'dividend' ? 4 : 2;
          return (
            <div key={p.id} className="od-ptable-row">
              <div className="od-ptable-asset">
                <AssetLogo
                  symbol={p.terms.symbol}
                  src={logoOf(p.terms.symbol)}
                  size={24}
                />
                <div>
                  <b>{contractTitle(p.terms)}</b>
                  <small>
                    {qty(p.terms.quantity)} {p.terms.symbol}, expires{' '}
                    {expiryLabel(p.terms.expiry)}
                  </small>
                </div>
              </div>
              <span className="od-ptable-type">Option</span>
              <div className="od-ptable-num">
                <b>{usd(value, dp)}</b>
                <small>{usd(p.premium, dp)} cost</small>
              </div>
              <div className="od-ptable-num">
                <b className={tone(pnl)}>{pnlText(pnl, dp)}</b>
                <small>Model mark</small>
              </div>
              <div className="od-ptable-act">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={requesting || desk.busy}
                  onClick={() => {
                    setRequesting(true);
                    void desk
                      .closeQuote(p.id)
                      .then(setQuote)
                      .catch((e) => desk.setToast((e as Error).message))
                      .finally(() => setRequesting(false));
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          );
        })}

        {loans.map((p) => (
          <div key={p.id} className="od-ptable-row">
            <div className="od-ptable-asset">
              <AssetLogo symbol={p.symbol} src={logoOf(p.symbol)} size={24} />
              <div>
                <b>
                  {qty(p.quantity)} {p.symbol} lent
                </b>
                <small>Until {expiryLabel(p.expiry)}</small>
              </div>
            </div>
            <span className="od-ptable-type">Stock loan</span>
            <div className="od-ptable-num">
              <b>{usd(p.quantity * spot(p.symbol))}</b>
              <small>{usd(p.collateral)} collateral held</small>
            </div>
            <div className="od-ptable-num">
              <b className="od-up">+{usd(p.prepaidInterest, 4)}</b>
              <small>Interest, prepaid</small>
            </div>
            <div className="od-ptable-act">
              <Button
                variant="ghost"
                size="sm"
                disabled={desk.busy}
                onClick={() =>
                  setReview({
                    action: { type: 'recall', id: p.id },
                    title: 'Review stock recall',
                    label: 'Interest you receive',
                    value: accruedInterest(
                      p.prepaidInterest,
                      p.opened,
                      p.expiry,
                      book.date,
                    ),
                    details: [
                      ['Shares returned', `${qty(p.quantity)} ${p.symbol}`],
                      [
                        'Unused borrower collateral',
                        'Returned to the borrower after repurchase',
                      ],
                    ],
                  })
                }
              >
                Recall
              </Button>
            </div>
          </div>
        ))}

        {borrows.map((p) => {
          const debt = borrowDebt(p, book.date);
          return (
            <div key={p.id} className="od-ptable-row">
              <div className="od-ptable-asset">
                <AssetLogo symbol="USDC" size={24} />
                <div>
                  <b>{usd(p.principal)} borrowed</b>
                  <small>
                    Against {qty(p.pledged)} {p.symbol},{' '}
                    {(p.apr * 100).toFixed(2)}%{' '}
                    {p.expiry
                      ? `fixed to ${expiryLabel(p.expiry)}`
                      : 'variable'}
                  </small>
                </div>
              </div>
              <span className="od-ptable-type">Cash loan</span>
              <div className="od-ptable-num">
                <b>−{usd(debt.total)}</b>
                <small>Owed</small>
              </div>
              <div className="od-ptable-num">
                <b className={tone(-debt.interest)}>
                  {pnlText(-debt.interest, 4)}
                </b>
                <small>Interest accrued</small>
              </div>
              <div className="od-ptable-act">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={desk.busy}
                  onClick={() =>
                    setReview({
                      action: { type: 'repay', id: p.id },
                      title: 'Review loan repayment',
                      label: 'You pay to repay',
                      value: debt.total,
                      details: [
                        ['Principal', usd(p.principal, 6)],
                        ['Interest accrued', usd(debt.interest, 6)],
                        [
                          'Pledge released',
                          `${qty(p.pledged)} ${p.symbol} back to free collateral`,
                        ],
                      ],
                    })
                  }
                >
                  Repay
                </Button>
              </div>
            </div>
          );
        })}

        {shorts.map((p) => {
          const pnl = p.quantity * (p.entry - spot(p.symbol)) - p.premium;
          return (
            <div key={p.id} className="od-ptable-row">
              <div className="od-ptable-asset">
                <AssetLogo symbol={p.symbol} src={logoOf(p.symbol)} size={24} />
                <div>
                  <b>
                    {qty(p.quantity)} {p.symbol} short
                  </b>
                  <small>
                    From {usd(p.entry)}, capped at {usd(p.cap)}
                  </small>
                </div>
              </div>
              <span className="od-ptable-type">Protected short</span>
              <div className="od-ptable-num">
                <b>−{usd(p.quantity * spot(p.symbol))}</b>
                <small>Until {expiryLabel(p.expiry)}</small>
              </div>
              <div className="od-ptable-num">
                <b className={tone(pnl)}>{pnlText(pnl)}</b>
                <small>After protection</small>
              </div>
              <div className="od-ptable-act">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={desk.busy}
                  onClick={() => {
                    const close = shortCloseAmounts(
                      p,
                      spot(p.symbol),
                      book.date,
                    );
                    setReview({
                      action: { type: 'close-short', id: p.id },
                      title: 'Review short close',
                      label: 'You pay to cover and repay',
                      value: close.total,
                      details: [
                        ['Repurchase cost', usd(close.repurchase, 6)],
                        ['Accrued borrow cost', usd(close.interest, 6)],
                        [
                          'Total P&L including paid protection',
                          usd(close.pnl, 6),
                        ],
                      ],
                    });
                  }}
                >
                  Cover
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {openCount === 0 && (
        <p className="od-positions-start">
          Nothing open against your stock yet.{' '}
          <button onClick={() => navigate('Trade', 'trade')}>
            Trade options
          </button>
          <button onClick={() => navigate('Lending')}>Lend or borrow</button>
        </p>
      )}

      {quote && (
        <QuoteReview
          quote={quote}
          revision={s.revision}
          busy={desk.busy}
          onClose={() => setQuote(null)}
          onConfirm={() => void executeClose()}
        />
      )}

      {review && (
        <Modal
          title={review.title}
          description="Every balance and reserve moves together, or nothing does."
          onClose={() => setReview(null)}
        >
          <div className="od-lines">
            <Line label={review.label} value={usd(review.value, 6)} />
            {review.details.map(([label, value]) => (
              <Line key={label} label={label} value={value} />
            ))}
          </div>
          <Button
            size="lg"
            full
            disabled={desk.busy}
            onClick={() => void confirm()}
          >
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- */

function Collateral({ desk }: { desk: VaultController }) {
  const s = desk.state!;
  const r = s.risk;
  return (
    <>
      <section className="od-collateral-hero" aria-label="Collateral overview">
        <div className="od-collateral-primary">
          <span>Available to withdraw</span>
          <strong>
            <Money value={r.availableValue} />
          </strong>
          <p>Funds not supporting an open position or a loan.</p>
        </div>
        <dl className="od-collateral-stats">
          <div className="od-stat">
            <dt>Collateral committed</dt>
            <dd>
              <Money value={r.collateralValue} />
            </dd>
            <small>{usd(r.cash)} cash reserve</small>
          </div>
          <div className="od-stat">
            <dt>Released by offsets</dt>
            <dd className={r.releasedValue > 0 ? 'up' : ''}>
              <Money value={r.releasedValue} />
            </dd>
            <small>Netted across eligible terms</small>
          </div>
        </dl>
      </section>

      <section className="od-collateral-section">
        <PanelHead
          title="Collateral policy"
          description="Choose how the vault reserves capital for your positions."
          action={<Badge tone="accent">Ledger enforced</Badge>}
        />
        <div className="od-collateral-modes">
          {(
            [
              {
                id: 'cross',
                title: 'Cross collateral',
                description:
                  'Net eligible positions to use capital efficiently.',
              },
              {
                id: 'isolated',
                title: 'Isolated collateral',
                description: 'Keep every position independently reserved.',
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              aria-label={m.title}
              aria-pressed={s.book.margin === m.id}
              className={`od-policy ${s.book.margin === m.id ? 'selected' : ''}`}
              disabled={desk.busy}
              onClick={() => void desk.act({ type: 'margin', mode: m.id })}
            >
              <span className="od-radio" />
              <div>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="od-collateral-section">
        <PanelHead
          title="Reserve coverage"
          description="Your available balance is always checked before a position can open or funds can leave the vault."
        />
        <div className="od-collateral-meters">
          <Meter
            label="Cash reserved"
            value={r.cash}
            of={Math.max(r.grossCash, r.cash, 1)}
            note={`${usd(r.cash)} held against ${usd(r.grossCash)} standalone requirement`}
          />
          <Meter
            label="Shares reserved"
            value={r.shares.NVDA}
            of={Math.max(r.grossShares.NVDA, r.shares.NVDA, 0.000001)}
            note={`${qty(r.shares.NVDA)} of ${qty(r.grossShares.NVDA)} NVDA standalone requirement`}
            color="var(--pc-magenta)"
          />
        </div>
      </section>

      {r.groups.length ? (
        <section className="od-collateral-section">
          <PanelHead
            title="Position reserves"
            description="Separate settlement dates retain a visible, fully funded reserve."
          />
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Expiry group</th>
                  <th className="num">Contracts</th>
                  <th>Settlement</th>
                  <th className="num">Standalone cash</th>
                  <th className="num">Shares reserved</th>
                  <th className="num">Counterparty backing</th>
                </tr>
              </thead>
              <tbody>
                {r.groups.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <b>{dateLabel(g.expiry)}</b>
                    </td>
                    <td className="num">{g.positions}</td>
                    <td>{g.settlement}</td>
                    <td className="num">
                      {usd(g.cash)}
                      {g.cashMinimum > 0 && (
                        <small>Guaranteed {usd(g.cashMinimum, 6)}</small>
                      )}
                    </td>
                    <td className="num">{qty(g.shares)}</td>
                    <td className="num">
                      {usd(g.counterpartyCash)}
                      <small>
                        {qty(g.counterpartyShares)} {g.symbol}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="od-collateral-idle">
          <div>
            <b>No position reserves</b>
            <p>
              Open option positions will appear here with the capital held for
              them.
            </p>
          </div>
        </section>
      )}

      <section className="od-collateral-check">
        <div>
          <b>Verify balances</b>
          <p>Reconcile the current ledger before acting on a discrepancy.</p>
        </div>
        <Button variant="secondary" onClick={() => void desk.refresh()}>
          Refresh balances
        </Button>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- */

/** A replay session is a date; a live receipt is an instant, read locally. */
const session = (date: string) =>
  date.includes('T')
    ? new Date(date).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
    : date;

function Receipt({
  id,
  signature,
  mode,
}: {
  id: string;
  signature?: string;
  mode: 'sandbox' | 'localnet' | 'devnet';
}) {
  const href = txLink(signature, mode);
  if (!href || !signature) return <>{id.slice(0, 8)}</>;
  return (
    <a
      className="od-tx-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={signature}
    >
      {shortSignature(signature)}
    </a>
  );
}

function Activity({ desk }: { desk: VaultController }) {
  const s = desk.state!;
  const [query, setQuery] = useState('');
  const events = s.book.events.filter((e) =>
    `${e.title} ${e.detail} ${e.date} ${e.via ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const onchain = s.mode !== 'sandbox';

  const download = () => {
    const rows = [
      [
        'date',
        'title',
        'detail',
        'cash',
        'shares',
        'reference',
        'via',
        ...(onchain ? ['signature'] : []),
      ],
      ...s.book.events.map((e) => [
        e.date,
        e.title,
        e.detail,
        String(e.cash),
        String(e.shares),
        e.reference || '',
        e.via || '',
        ...(onchain ? [s.signatures?.[e.id] ?? ''] : []),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parcel-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel>
      <PanelHead
        title="Activity"
        description="Every receipt this vault has issued, newest first."
        action={
          <div className="od-panel-actions">
            <label className="od-search">
              <Search size={15} />
              <input
                aria-label="Search activity"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Button variant="secondary" size="sm" onClick={download}>
              <Download size={14} />
              Export ledger
            </Button>
          </div>
        }
      />
      {events.length ? (
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Session</th>
                <th className="num">Cash</th>
                <th className="num">Shares</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 120).map((e) => (
                <tr key={e.id}>
                  <td>
                    <b>
                      {e.title}
                      {e.via === 'agent' && (
                        <span className="od-agent-tag">Agent</span>
                      )}
                    </b>
                    <small>{e.detail}</small>
                  </td>
                  <td title={e.date}>{session(e.date)}</td>
                  <td
                    className={`num ${e.cash > 0 ? 'od-up' : e.cash < 0 ? 'od-down' : ''}`}
                  >
                    {e.cash ? usd(e.cash) : '—'}
                  </td>
                  <td className="num">{e.shares ? qty(e.shares) : '—'}</td>
                  <td className="od-muted">
                    <Receipt
                      id={e.id}
                      signature={s.signatures?.[e.id]}
                      mode={s.mode}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Nothing matches"
          description="Clear the search to see every receipt this vault has issued."
        />
      )}
      <div className="od-panel-foot">
        <span>Revision {s.revision}</span>
        <span>{s.book.events.length} receipts</span>
      </div>
    </Panel>
  );
}
