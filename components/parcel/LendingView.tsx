'use client';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, TriangleAlert } from 'lucide-react';
import { AssetLogo } from './AssetLogo';
import { logoOf } from '@/lib/preipo/registry';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { MarkFeed } from '@/hooks/parcel/use-marks';
import type { MarketUnderlying, VaultAction } from '@/lib/parcel/types';
import { amount } from '@/lib/parcel/validation';
import { add, mul, round } from '@/lib/parcel/math';
import {
  borrowDebt,
  borrowInterest,
  termInterest,
  protectionPremium,
} from '@/lib/parcel/funding';
import {
  borrowLimit,
  categoryOf,
  crossBorrowCap,
  CRYPTO_MARKETS,
  health,
  liquidationPrice,
  MARKET_CATEGORIES,
  pledgeLiquidationPrice,
  RESTING_UTILISATION,
  rates,
  reserveOf,
  xstockTicker,
  type Holding,
  type MarketCategory,
} from '@/lib/parcel/lending';
import {
  useTokenizedEquities,
  useTokenizedEquityQuotes,
} from '@/hooks/parcel/use-tokenized-equities';
import { offeredExpiries } from '@/lib/parcel/market';
import { RateCurve } from './charts';
import { ExpiryPicker } from './ExpiryPicker';
import {
  AssetPicker,
  markOf,
  Button,
  Field,
  Line,
  Modal,
  Panel,
  PanelHead,
  Segmented,
  Stat,
  expiryLabel,
  qty,
  usd,
} from './shared';

export type LendingTab = 'borrow';
type Mode = 'borrow' | 'short' | 'lend' | 'stock';
const MODES: Mode[] = ['borrow', 'short', 'lend', 'stock'];
type View = Mode | 'markets';
const EMPTY_UNDERLYINGS: MarketUnderlying[] = [];

export function LendingView({
  desk,
  feed,
  mode,
  symbol,
  onSymbol,
  onMode,
}: {
  desk: VaultController;
  feed: MarkFeed;
  /** Markets, or borrow, short, lend or spot — chosen in the rail. */
  mode: string;
  /** The underlying being lent, shorted or bought. */
  symbol: string;
  onSymbol: (symbol: string) => void;
  /** Open another view of lending: the markets list or a ticket. */
  onMode: (mode: View) => void;
}) {
  const s = desk.state!;
  const underlyings = s.market.underlyings ?? EMPTY_UNDERLYINGS;

  /**
   * The desk's own position, expressed in money-market terms.
   *
   * Vault assets are collateral; shares sold short are the debt. It is
   * the same book the rest of the product shows, read through the
   * lending model so one health factor covers all of it.
   */
  const position = useMemo(() => {
    const priceOf = (of: string) =>
      underlyings.find((u) => u.symbol === of)?.price ?? 1;
    const collateral: Holding[] = [
      { symbol: 'USDC', amount: s.book.vault.USDC, price: 1 },
      ...underlyings.map((u) => ({
        symbol: u.symbol,
        amount: s.book.vault[u.symbol] ?? 0,
        price: u.price,
      })),
    ].filter((h) => h.amount > 0);
    // Every short is debt, each at its own mark; the liquidation level
    // is quoted for the underlying on screen, with the rest as a fixed
    // charge against the same collateral.
    const shortedBy: Record<string, number> = {};
    for (const p of s.book.shorts.filter((p) => p.status === 'active'))
      shortedBy[p.symbol] = (shortedBy[p.symbol] ?? 0) + p.quantity;
    const debt: Holding[] = Object.entries(shortedBy).map(([of, amount]) => ({
      symbol: of,
      amount,
      price: priceOf(of),
    }));
    // Cash loans are dollar debt against the same collateral. Their
    // pledges are already in the vault list above, so the one health
    // factor covers shorts and loans together.
    // A server that predates cash loans answers without the list; a
    // deploy overlap should not blank the whole desk.
    for (const p of (s.book.borrows ?? []).filter((p) => p.status === 'active'))
      debt.push({
        symbol: 'USDC',
        amount: borrowDebt(p, s.book.date).total,
        price: 1,
      });
    const h = health(collateral, debt);
    const weighted = collateral.reduce((t, c) => {
      const r = reserveOf(c.symbol);
      return t + (r ? c.amount * c.price * r.liquidation : 0);
    }, 0);
    const shorted = shortedBy[symbol] ?? 0;
    const otherDebt = debt
      .filter((d) => d.symbol !== symbol)
      .reduce((t, d) => t + d.amount * d.price, 0);
    return {
      ...h,
      collateral,
      debt,
      shorted,
      weighted,
      liquidation: liquidationPrice(weighted, shorted, otherDebt),
    };
  }, [s, symbol, underlyings]);

  if (!MODES.includes(mode as Mode))
    return (
      <Markets
        desk={desk}
        feed={feed}
        onOpen={(next, of) => {
          onSymbol(of);
          onMode(next);
        }}
      />
    );
  return (
    <>
      <button className="od-company-back" onClick={() => onMode('markets')}>
        <ArrowLeft size={14} />
        Lending markets
      </button>
      <Borrow
        desk={desk}
        feed={feed}
        position={position}
        mode={mode as Mode}
        symbol={symbol}
        onSymbol={onSymbol}
        onMode={onMode}
      />
    </>
  );
}

type MarketSort = 'positions' | 'liquidity' | 'supply' | 'borrow' | 'name';

const MARKET_SORTS: { id: MarketSort; label: string }[] = [
  { id: 'positions', label: 'Your positions' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'supply', label: 'Supply APY' },
  { id: 'borrow', label: 'Borrow APY' },
  { id: 'name', label: 'Name' },
];

/** Markets the desk does not list: tokenized-equity wrappers and crypto. */
const HIDDEN_CATEGORIES = new Set<string>(['xstocks', 'crypto']);

/** First-paint size for the xStocks chip — held + mega-caps + catalog fill. */
const XSTOCKS_PAGE = 48;
/** Cap browse-without-search so quote polling stays bounded. */
const XSTOCKS_BROWSE_MAX = 120;
const XSTOCKS_SEARCH_MAX = 60;

/**
 * Every pool the vault can supply to or borrow from, the way a money
 * market lists them — equities, crypto, Pre-IPO, xStocks and stables,
 * sorted with category chips at the top.
 */
function Markets({
  desk,
  feed,
  onOpen,
}: {
  desk: VaultController;
  feed: MarkFeed;
  onOpen: (mode: Mode, symbol: string) => void;
}) {
  const s = desk.state!;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MarketCategory | 'all'>('all');
  const [sort, setSort] = useState<MarketSort>('positions');
  const [xstocksLimit, setXstocksLimit] = useState(XSTOCKS_PAGE);
  const { data: tokenized } = useTokenizedEquities();
  const xstocks = useMemo(
    () => (tokenized?.assets ?? []).filter((a) => a.provider === 'xstocks'),
    [tokenized],
  );
  // Mega-caps always included in the curated / All surfaces.
  const FEATURED_XSTOCKS = useMemo(
    () =>
      new Set(['NVDAx', 'AAPLx', 'MSFTx', 'AMZNx', 'GOOGLx', 'METAx', 'TSLAx']),
    [],
  );

  /** Symbols the vault actually holds or owes against — those lead the list. */
  const heldTickers = useMemo(() => {
    const held = new Set<string>();
    if (s.book.vault.USDC > 0) held.add('USDC');
    for (const [symbol, amount] of Object.entries(s.book.vault))
      if (amount > 0) held.add(symbol);
    for (const p of s.book.shorts.filter((row) => row.status === 'active'))
      held.add(p.symbol);
    for (const p of (s.book.borrows ?? []).filter(
      (row) => row.status === 'active',
    ))
      held.add(p.symbol);
    for (const p of (s.book.loans ?? []).filter(
      (row) => row.status === 'active',
    ))
      held.add(p.symbol);
    return held;
  }, [s.book]);

  const listedXstocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const heldX = (a: (typeof xstocks)[number]) =>
      heldTickers.has(a.underlyingSymbol) ||
      heldTickers.has(xstockTicker(a.id)) ||
      heldTickers.has(a.symbol);
    const byTicker = (
      a: (typeof xstocks)[number],
      b: (typeof xstocks)[number],
    ) => a.symbol.localeCompare(b.symbol);

    if (category === 'xstocks') {
      if (q) {
        return xstocks
          .filter((a) =>
            `${a.name} ${a.symbol} ${a.underlyingSymbol}`
              .toLowerCase()
              .includes(q),
          )
          .sort((a, b) => Number(heldX(b)) - Number(heldX(a)) || byTicker(a, b))
          .slice(0, XSTOCKS_SEARCH_MAX);
      }
      // Larger sensible set: positions, then featured mega-caps, then
      // alphabetical fill up to the browse limit — not the full 1k+.
      const held = xstocks.filter(heldX).sort(byTicker);
      const featured = xstocks
        .filter((a) => !heldX(a) && FEATURED_XSTOCKS.has(a.symbol))
        .sort(byTicker);
      const rest = xstocks
        .filter((a) => !heldX(a) && !FEATURED_XSTOCKS.has(a.symbol))
        .sort(byTicker);
      const preferred = [...held, ...featured];
      const fill = rest.slice(0, Math.max(0, xstocksLimit - preferred.length));
      return [...preferred, ...fill];
    }
    // All / other chips: only held matches + featured mega-caps so All
    // does not paint the entire xStocks catalog.
    return xstocks.filter((a) => heldX(a) || FEATURED_XSTOCKS.has(a.symbol));
  }, [category, query, xstocks, FEATURED_XSTOCKS, heldTickers, xstocksLimit]);
  const xstockIds = useMemo(
    () => listedXstocks.map((a) => a.id),
    [listedXstocks],
  );
  const quotes = useTokenizedEquityQuotes(xstockIds);

  const pools = useMemo(() => {
    const seen = new Set<string>();
    const rows: {
      key: string;
      symbol: string;
      name: string;
      category: MarketCategory;
      price: number | null;
      supplied: number;
      borrowed: number;
      supply: number;
      borrow: number;
      cash: boolean;
      tradeable: boolean;
      priced: boolean;
      logo: string | null;
      held: boolean;
      liquidity: number;
    }[] = [];

    const isHeld = (symbol: string, key = symbol) =>
      heldTickers.has(symbol) ||
      heldTickers.has(xstockTicker(key)) ||
      heldTickers.has(key);

    const push = (
      row: Omit<(typeof rows)[number], 'held' | 'liquidity'> & {
        held?: boolean;
      },
    ) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      const price = row.price ?? 0;
      const liquidity =
        row.priced && price > 0 ? (row.supplied + row.borrowed) * price : 0;
      rows.push({
        ...row,
        held: row.held ?? isHeld(row.symbol, row.key),
        liquidity,
      });
    };

    for (const u of s.market.underlyings ?? EMPTY_UNDERLYINGS) {
      const reserve = reserveOf(u.symbol);
      if (!reserve) continue;
      const mark = feed.marks[u.symbol];
      const price = mark?.price ?? u.price;
      const util = mark?.utilisation ?? RESTING_UTILISATION;
      const r = rates(util, reserve);
      push({
        key: u.symbol,
        symbol: u.symbol,
        name: u.name,
        category: reserve.category,
        price,
        supplied: mark?.supplied ?? 0,
        borrowed: mark?.borrowed ?? 0,
        supply: r.supply,
        borrow: r.borrow,
        cash: false,
        tradeable: true,
        priced: true,
        logo: logoOf(u.symbol),
      });
    }

    for (const symbol of CRYPTO_MARKETS) {
      const reserve = reserveOf(symbol);
      const mark = feed.marks[symbol];
      if (!reserve || !mark) continue;
      const r = rates(mark.utilisation ?? RESTING_UTILISATION, reserve);
      push({
        key: symbol,
        symbol,
        name: reserve.name,
        category: 'crypto',
        price: mark.price,
        supplied: mark.supplied,
        borrowed: mark.borrowed,
        supply: r.supply,
        borrow: r.borrow,
        cash: false,
        tradeable: false,
        priced: true,
        logo: null,
      });
    }

    {
      const reserve = reserveOf('USDC')!;
      const mark = feed.marks.USDC;
      const r = rates(mark?.utilisation ?? RESTING_UTILISATION, reserve);
      push({
        key: 'USDC',
        symbol: 'USDC',
        name: 'USD Coin',
        category: 'stable',
        price: mark?.price ?? 1,
        supplied: mark?.supplied ?? 0,
        borrowed: mark?.borrowed ?? 0,
        supply: r.supply,
        borrow: r.borrow,
        cash: true,
        tradeable: true,
        priced: true,
        logo: null,
      });
    }

    for (const asset of listedXstocks) {
      const reserve = reserveOf(asset.id);
      if (!reserve) continue;
      const quote = quotes[asset.id];
      const price =
        quote?.state === 'live' && quote.quote != null ? quote.quote : null;
      // Depth is not published by the issuer; rates still follow the
      // Aave two-slope model at resting utilisation so the APY columns
      // stay comparable without inventing a pool.
      const r = rates(RESTING_UTILISATION, reserve);
      push({
        key: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        category: 'xstocks',
        price,
        supplied: 0,
        borrowed: 0,
        supply: r.supply,
        borrow: r.borrow,
        cash: false,
        tradeable: false,
        priced: price != null,
        logo: asset.logo,
        held:
          heldTickers.has(asset.underlyingSymbol) ||
          heldTickers.has(xstockTicker(asset.id)),
      });
    }

    const q = query.trim().toLowerCase();
    const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      a.name.localeCompare(b.name) || a.symbol.localeCompare(b.symbol);
    const byLiquidity = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      b.liquidity - a.liquidity || byName(a, b);
    return rows
      .filter((p) => !HIDDEN_CATEGORIES.has(p.category))
      .filter((p) => category === 'all' || p.category === category)
      .filter((p) =>
        q ? `${p.name} ${p.symbol}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => {
        switch (sort) {
          case 'liquidity':
            return byLiquidity(a, b);
          case 'supply':
            return b.supply - a.supply || byName(a, b);
          case 'borrow':
            return b.borrow - a.borrow || byName(a, b);
          case 'name':
            return byName(a, b);
          case 'positions':
          default:
            if (a.held !== b.held) return a.held ? -1 : 1;
            return byLiquidity(a, b);
        }
      });
  }, [
    s.market.underlyings,
    feed.marks,
    listedXstocks,
    quotes,
    category,
    query,
    heldTickers,
    sort,
  ]);

  const catalogCounts = useMemo(() => {
    const base = {
      all: 0,
      equity: 0,
      crypto: 0,
      preipo: 0,
      xstocks: 0,
      stable: 0,
    };
    for (const u of s.market.underlyings ?? EMPTY_UNDERLYINGS) {
      const cat = categoryOf(u.symbol);
      if (cat) {
        base[cat] += 1;
        base.all += 1;
      }
    }
    for (const symbol of CRYPTO_MARKETS) {
      if (feed.marks[symbol]) base.crypto += 1;
    }
    base.stable += 1;
    base.all += 1;
    base.xstocks =
      category === 'xstocks'
        ? listedXstocks.length || FEATURED_XSTOCKS.size
        : Math.min(XSTOCKS_PAGE, xstocks.length || FEATURED_XSTOCKS.size);
    // All lists neither crypto nor xStocks; the desk does not show them.
    return base;
  }, [
    s.market.underlyings,
    feed.marks,
    listedXstocks,
    FEATURED_XSTOCKS,
    category,
    xstocks,
  ]);

  const size = pools.reduce(
    (t, p) => t + (p.priced && p.price != null ? p.supplied * p.price : 0),
    0,
  );
  const out = pools.reduce(
    (t, p) => t + (p.priced && p.price != null ? p.borrowed * p.price : 0),
    0,
  );
  const units = (n: number) =>
    n >= 1e9
      ? `${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(2)}M`
        : n >= 1e3
          ? `${(n / 1e3).toFixed(2)}K`
          : n.toFixed(2);
  const pct = (n: number) =>
    n > 0 && n < 0.0001 ? '< 0.01%' : `${(n * 100).toFixed(2)}%`;
  const pledge =
    (s.market.underlyings ?? EMPTY_UNDERLYINGS).find(
      (u) => (s.risk.freeShares[u.symbol] ?? 0) > 0,
    )?.symbol ?? 'NVDA';

  const openDetails = (p: (typeof pools)[number]) => {
    if (p.cash) {
      onOpen('borrow', pledge);
      return;
    }
    if (p.tradeable) {
      onOpen('lend', p.symbol);
      return;
    }
    if (p.category === 'xstocks') {
      const ticker = xstockTicker(p.key);
      const vaulted = (s.market.underlyings ?? EMPTY_UNDERLYINGS).some(
        (u) => u.symbol === ticker,
      );
      onOpen(vaulted ? 'lend' : 'borrow', vaulted ? ticker : pledge);
      return;
    }
    // Crypto: show the cash-loan ticket against vault stock; rates for
    // SOL/BTC/ETH stay on the list (live marks) without a vault mint.
    onOpen('borrow', pledge);
  };

  return (
    <section className="od-lm" aria-labelledby="lm-title">
      <div className="od-lm-head">
        <h2 id="lm-title">Lending markets</h2>
        <dl>
          <div>
            <dt>Market size</dt>
            <dd>{compactUsd(size)}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{compactUsd(Math.max(0, size - out))}</dd>
          </div>
          <div>
            <dt>Borrowed</dt>
            <dd>{compactUsd(out)}</dd>
          </div>
        </dl>
      </div>

      <div className="od-lm-toolbar">
        <div
          className="od-lm-cats"
          role="tablist"
          aria-label="Market categories"
        >
          {MARKET_CATEGORIES.filter((c) => !HIDDEN_CATEGORIES.has(c.id)).map(
            (c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                className={category === c.id ? 'active' : undefined}
                onClick={() => {
                  setCategory(c.id);
                  if (c.id !== 'xstocks') setXstocksLimit(XSTOCKS_PAGE);
                }}
              >
                {c.label}
                <small>{catalogCounts[c.id]}</small>
              </button>
            ),
          )}
        </div>
        <div className="od-lm-toolbar-tools">
          <label className="od-lm-sort">
            <span>Sort</span>
            <select
              aria-label="Sort lending markets"
              value={sort}
              onChange={(e) => setSort(e.target.value as MarketSort)}
            >
              {MARKET_SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="od-lm-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              placeholder="Name or symbol"
              aria-label="Search lending markets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="od-lm-table">
        <div className="od-lm-row od-lm-cols">
          <span>Asset</span>
          <span>Total supplied</span>
          <span>Supply APY</span>
          <span>Total borrowed</span>
          <span>Borrow APY</span>
          <span />
        </div>
        {pools.length === 0 && (
          <p className="od-lm-empty">
            {query.trim()
              ? 'No markets match this search.'
              : 'No markets in this category yet.'}
          </p>
        )}
        {category === 'xstocks' && !query.trim() && xstocks.length > 0 && (
          <p className="od-lm-empty">
            Showing {listedXstocks.length.toLocaleString()} of{' '}
            {xstocks.length.toLocaleString()} — search for the rest.
          </p>
        )}
        {pools.map((p) => (
          <div key={p.key} className={`od-lm-row${p.held ? ' held' : ''}`}>
            <span className="od-lm-asset">
              <AssetLogo symbol={p.symbol} src={p.logo} size={34} />
              <span className="od-lm-asset-copy">
                <span className="od-lm-asset-title">
                  <span className="od-lm-asset-name">{p.name}</span>
                  {p.held ? (
                    <em className="od-lm-held">Your position</em>
                  ) : null}
                </span>
                <small>
                  <span className="od-lm-asset-ticker">{p.symbol}</span>
                  {p.category !== 'equity' ? (
                    <span> · {labelOf(p.category)}</span>
                  ) : null}
                  <span>
                    {p.price != null
                      ? ` · ${usd(p.price)}`
                      : ' · Price pending'}
                  </span>
                </small>
              </span>
            </span>
            <span className="od-lm-num">
              <b>
                {p.category === 'xstocks'
                  ? p.priced
                    ? 'Issuer'
                    : '—'
                  : units(p.supplied)}
              </b>
              <small>
                {p.category === 'xstocks'
                  ? p.priced
                    ? 'Live quote'
                    : quoteState(quotes[p.key]?.state)
                  : p.priced && p.price != null
                    ? compactUsd(p.supplied * p.price)
                    : '—'}
              </small>
            </span>
            <span className="od-lm-num">
              <b>{p.cash ? pct(p.supply) : pct(p.supply)}</b>
            </span>
            <span className="od-lm-num">
              <b>{p.category === 'xstocks' ? '—' : units(p.borrowed)}</b>
              <small>
                {p.category === 'xstocks' || !p.priced || p.price == null
                  ? '—'
                  : compactUsd(p.borrowed * p.price)}
              </small>
            </span>
            <span className="od-lm-num">
              <b>{pct(p.borrow)}</b>
            </span>
            <span className="od-lm-act">
              <button type="button" onClick={() => openDetails(p)}>
                Details
              </button>
            </span>
          </div>
        ))}
        {category === 'xstocks' &&
          !query.trim() &&
          listedXstocks.length < xstocks.length &&
          xstocksLimit < XSTOCKS_BROWSE_MAX && (
            <div className="od-lm-more">
              <button
                type="button"
                onClick={() =>
                  setXstocksLimit((n) =>
                    Math.min(XSTOCKS_BROWSE_MAX, n + XSTOCKS_PAGE),
                  )
                }
              >
                Show more
                <small>
                  {(
                    Math.min(XSTOCKS_BROWSE_MAX, xstocks.length) -
                    listedXstocks.length
                  ).toLocaleString()}{' '}
                  more on this list · search for the full catalog
                </small>
              </button>
            </div>
          )}
        {category === 'xstocks' &&
          !query.trim() &&
          xstocksLimit >= XSTOCKS_BROWSE_MAX &&
          listedXstocks.length < xstocks.length && (
            <p className="od-lm-empty">
              Browse capped at {XSTOCKS_BROWSE_MAX}. Search by name or ticker to
              reach the remaining{' '}
              {(xstocks.length - listedXstocks.length).toLocaleString()}{' '}
              xStocks.
            </p>
          )}
      </div>
    </section>
  );
}

const labelOf = (c: MarketCategory) =>
  MARKET_CATEGORIES.find((row) => row.id === c)?.label ?? c;

const quoteState = (state?: string) =>
  state === 'unavailable'
    ? 'Unavailable'
    : state === 'pending'
      ? 'Pending'
      : '—';

/** $4.80B, $62.89M, $154.80K — the way a money market prints size. */
const compactUsd = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1e3
        ? `$${(n / 1e3).toFixed(2)}K`
        : usd(n);

type Position = ReturnType<typeof usePositionShape>;
// Only for the type; the value is built inline above.
function usePositionShape() {
  return {
    factor: 0,
    supplied: 0,
    owed: 0,
    borrowPower: 0,
    available: 0,
    used: 0,
    collateral: [] as Holding[],
    debt: [] as Holding[],
    shorted: 0,
    weighted: 0,
    liquidation: null as number | null,
  };
}

/* ---------------------------------------------------------------- */

function Borrow({
  desk,
  feed,
  position,
  mode,
  symbol,
  onSymbol,
  onMode,
}: {
  desk: VaultController;
  feed: MarkFeed;
  position: Position;
  mode: Mode;
  symbol: string;
  onSymbol: (symbol: string) => void;
  onMode: (mode: View) => void;
}) {
  const s = desk.state!;
  const underlyings = s.market.underlyings ?? EMPTY_UNDERLYINGS;
  const under = underlyings.find((u) => u.symbol === symbol) ?? underlyings[0];
  const price =
    markOf(s, feed, symbol)?.price ?? under?.price ?? s.market.price;
  const volatility = under?.volatility ?? s.market.volatility;
  // Spot fills at the ask to buy and the bid to sell, as the server does.
  const quoteMark = markOf(s, feed, symbol);
  const live = s.market.clock === 'live';
  // Daily closes only. The date list also carries the test clock's
  // hourly ticks, and a loan that ends an hour from now is not a term
  // anyone means to pick. Default to the first close at least two
  // weeks out, so the figures describe a loan rather than an afternoon.
  const future = offeredExpiries(s.market, s.book.date);
  const fortnight = new Date(Date.parse(s.book.date) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const defaultExpiry =
    future.find((d) => d >= fortnight) || future.at(-1) || s.book.date;

  const reserve = reserveOf(symbol);
  // A reserve with no observed pool mark is still executable: the server
  // quotes it at the same resting utilisation rather than at a fictitious
  // zero-rate pool. Keep every lending disclosure on that input.
  const pool = feed.marks[symbol];
  const utilisation = pool?.utilisation ?? RESTING_UTILISATION;
  const [quantity, setQuantity] = useState('1');
  const [cap, setCap] = useState(String(Math.ceil(price * 1.12)));
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const bid = live && quoteMark ? quoteMark.bid : price;
  const ask = live && quoteMark ? quoteMark.ask : price;
  const fill = side === 'buy' ? ask : bid;
  // A cash loan: half of what one share can carry, so the first read
  // shows a loan with room in it rather than one at the edge.
  const [amount_, setAmount] = useState(
    String(
      Math.max(1, Math.floor(reserve ? borrowLimit(1, price, reserve) / 2 : 1)),
    ),
  );
  const [rateKind, setRateKind] = useState<'variable' | 'fixed'>('variable');
  const [review, setReview] = useState<{
    action: VaultAction;
    revision: number;
    title: string;
    label: string;
    value: number;
    details: [string, string][];
  } | null>(null);

  const end = expiry > s.book.date ? expiry : defaultExpiry;
  const q = Number(quantity);
  const k = Number(cap);
  const b = Number(amount_);
  const pledgeLimit = reserve ? borrowLimit(q || 0, price, reserve) : 0;
  // Cross-margin: the pledge LTV still caps the draw, and portfolio
  // borrow power (all vault collateral vs all debt) caps it again.
  const limit = crossBorrowCap(pledgeLimit, position.available);
  const termed =
    mode !== 'stock' && !(mode === 'borrow' && rateKind === 'variable');

  let valid = !termed || future.length > 0;
  try {
    amount(q);
    if (mode === 'short') {
      amount(k, 0.000001, Math.min(10000, price * 2));
      if (k <= price) valid = false;
    }
    if (mode === 'borrow') {
      amount(b, 0.000001, 1000000);
      if (!reserve || b > limit) valid = false;
    }
  } catch {
    valid = false;
  }
  // On the live market the server fills spot only against a fresh stock
  // quote. Without one, say so here rather than letting a reviewed order
  // fail at confirmation.
  const noBook =
    live &&
    mode === 'stock' &&
    !(
      (quoteMark?.source === 'massive-nbbo' || quoteMark?.source === 'yahoo') &&
      !quoteMark.stale
    );
  if (noBook) valid = false;

  // Stock loans lock 3.5% in the ledger (termInterest embeds the same rate).
  const stockLoanApr = 0.035;
  const interest =
    valid && (mode === 'lend' || mode === 'short')
      ? termInterest(q, price, s.book.date, end)
      : 0;
  const interestEach =
    valid && (mode === 'lend' || mode === 'short')
      ? termInterest(1, price, s.book.date, end)
      : 0;
  const protection =
    valid && mode === 'short'
      ? protectionPremium(q, price, k, s.book.date, end, volatility)
      : 0;
  const protectionEach =
    valid && mode === 'short'
      ? protectionPremium(1, price, k, s.book.date, end, volatility)
      : 0;

  // What this borrow would do to the health factor, before it is taken.
  const projected = (() => {
    if (mode !== 'short' || !valid) return null;
    const weighted = position.weighted;
    const owed = position.owed + q * price;
    const otherDebt = position.debt
      .filter((d) => d.symbol !== symbol)
      .reduce((t, d) => t + d.amount * d.price, 0);
    return {
      factor: owed > 0 ? weighted / owed : Infinity,
      liquidation: liquidationPrice(weighted, position.shorted + q, otherDebt),
      owed,
    };
  })();

  /**
   * The cash loan, as the ledger will price it.
   *
   * The rate is the pool's, off the same curve the panel below draws,
   * read from the live feed; the server reads the same feed when the
   * loan opens, so the two agree to within a poll. A fixed loan's
   * interest is known now; a variable one's is whatever the sessions
   * bring, so it is shown as the first day's run.
   */
  const apr = reserve ? rates(utilisation, reserve).borrow : 0;
  const dayAhead = new Date(Date.parse(s.book.date) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const loan = (() => {
    if (mode !== 'borrow' || !valid || !reserve) return null;
    const termCost =
      rateKind === 'fixed' ? borrowInterest(b, apr, s.book.date, end) : 0;
    const dayCost = borrowInterest(b, apr, s.book.date, dayAhead);
    const owed = position.owed + b;
    return {
      termCost,
      dayCost,
      perShare: q > 0 ? (rateKind === 'fixed' ? termCost : dayCost) / q : 0,
      ltv: q > 0 ? b / (q * price) : 0,
      factor: owed > 0 ? position.weighted / owed : Infinity,
      liquidation: pledgeLiquidationPrice(b + termCost, q, reserve),
    };
  })();
  const aprLabel = `${(apr * 100).toFixed(2)}% APR`;
  const stockAprLabel = `${(stockLoanApr * 100).toFixed(2)}% APR`;

  /** Ticket price strip: ledger figures, always per share and total. */
  const ticketPrice =
    mode === 'lend'
      ? {
          label: 'Interest you earn',
          each: usd(interestEach),
          total: usd(interest),
          note: `${stockAprLabel} · prepaid at signing · until ${expiryLabel(end)}`,
        }
      : mode === 'short'
        ? {
            label: 'Protection + max interest',
            each: usd(add(protectionEach, interestEach)),
            total: usd(add(protection, interest)),
            note: `Call ${usd(k, 2)} · interest ${usd(interestEach)}/sh · protection ${usd(protectionEach)}/sh`,
          }
        : mode === 'borrow' && loan
          ? rateKind === 'fixed'
            ? {
                label: 'Interest locked',
                each: usd(loan.perShare),
                total: usd(loan.termCost),
                note: `${aprLabel} fixed · per pledged share · until ${expiryLabel(end)}`,
              }
            : {
                label: 'Interest today',
                each: usd(loan.perShare),
                total: usd(loan.dayCost),
                note: `${aprLabel} variable · per pledged share · one session at today's pool rate`,
              }
          : null;
  const openReview = () =>
    setReview({
      action:
        mode === 'lend'
          ? { type: 'lend', quantity: q, expiry: end, symbol }
          : mode === 'short'
            ? { type: 'short', quantity: q, cap: k, expiry: end, symbol }
            : mode === 'borrow'
              ? {
                  type: 'borrow',
                  pledged: q,
                  amount: b,
                  rate: rateKind,
                  ...(rateKind === 'fixed' ? { expiry: end } : {}),
                  symbol,
                }
              : { type: 'stock', side, quantity: q, symbol },
      revision: s.revision,
      title:
        mode === 'lend'
          ? 'Fund this stock loan?'
          : mode === 'short'
            ? 'Open this protected short?'
            : mode === 'borrow'
              ? 'Draw this cash loan?'
              : 'Confirm stock exchange',
      label:
        mode === 'lend'
          ? 'Borrower posts cash'
          : mode === 'short'
            ? 'Maximum cash reserved'
            : mode === 'borrow'
              ? 'You receive now'
              : 'Total consideration',
      details:
        mode === 'borrow'
          ? [
              ['Pledged', `${qty(q)} ${symbol}`],
              [
                'Rate',
                rateKind === 'fixed'
                  ? `${aprLabel} fixed until ${expiryLabel(end)}`
                  : `${aprLabel} variable · open-ended`,
              ],
              ...(rateKind === 'fixed'
                ? [
                    [
                      'Interest',
                      `${usd(loan?.termCost ?? 0)} · ${usd(loan?.perShare ?? 0)}/share`,
                    ] as [string, string],
                  ]
                : [
                    [
                      'Interest today',
                      `${usd(loan?.dayCost ?? 0)} · ${usd(loan?.perShare ?? 0)}/share`,
                    ] as [string, string],
                  ]),
              [
                'Pledge sold below',
                loan?.liquidation != null ? usd(loan.liquidation) : '—',
              ],
            ]
          : mode === 'stock'
            ? [
                [
                  'Direction',
                  side === 'buy' ? 'Buy owned stock' : 'Sell owned stock',
                ],
                ['Settlement', 'Immediate stock and USDC exchange'],
                ['Fill', `${usd(fill)} a share`],
              ]
            : [
                ['Term ends', expiryLabel(end)],
                ['Borrow rate', stockAprLabel],
                [
                  'Full-term interest',
                  `${usd(interest)} · ${usd(interestEach)}/share`,
                ],
                ['Stock sale proceeds', usd(mul(q, price))],
                [
                  'Protective call',
                  `Buy ${qty(q)} ${symbol} call at ${usd(mode === 'lend' ? round(price * 1.5) : k, 2)}`,
                ],
                [
                  `Protection premium paid by ${mode === 'lend' ? 'the borrower' : 'you'}`,
                  usd(
                    mode === 'lend'
                      ? protectionPremium(
                          q,
                          price,
                          round(price * 1.5),
                          s.book.date,
                          end,
                          volatility,
                        )
                      : protection,
                    6,
                  ),
                ],
                [
                  'Your cash movement now',
                  mode === 'lend'
                    ? '$0.00'
                    : usd(add(mul(q, price), -protection), 6),
                ],
              ],
      value:
        mode === 'lend'
          ? add(mul(q, round(price * 1.5)), interest)
          : mode === 'short'
            ? add(mul(q, k), interest)
            : mode === 'borrow'
              ? b
              : mul(q, fill),
    });

  const confirm = async () => {
    if (review && (await desk.act(review.action, review.revision)))
      setReview(null);
  };

  /**
   * The NVDA pool, and the curve its rates come off.
   *
   * Depth and borrowed size are simulated — no venue publishes a
   * lending book for this — so the panel says so rather than letting
   * the numbers pass for a market. The curve itself is not simulated:
   * it is the reserve's own two-slope model, which is what actually
   * prices every loan on this screen.
   */
  const here = reserve
    ? rates(utilisation, reserve)
    : { borrow: 0, supply: 0, utilisation: 0 };
  const curve = reserve
    ? Array.from({ length: 101 }, (_, i) => {
        const u = i / 100;
        const r = rates(u, reserve);
        return { u, borrow: r.borrow, supply: r.supply };
      })
    : [];

  /* What each screen is about, as one number, and the three figures
     that explain it. Anything that needed a sentence to read is on the
     review, where the reader has asked for it. */
  const read =
    mode === 'borrow'
      ? {
          eyebrow: 'Borrow against stock',
          label: 'You receive now',
          value: usd(b || 0),
          tone: 'up' as const,
          caption:
            rateKind === 'fixed'
              ? `Locked at ${aprLabel} until ${expiryLabel(end)}. ${qty(q)} ${symbol} stays in your vault, pledged.`
              : `Variable at ${aprLabel} today — open-ended, repriced each session as the ${symbol} pool moves. ${qty(q)} ${symbol} stays pledged.`,
          figures: [
            {
              label:
                rateKind === 'fixed' ? 'Interest / share' : 'Today / share',
              value: usd(loan?.perShare ?? 0),
              detail:
                rateKind === 'fixed'
                  ? `${usd(loan?.termCost ?? 0)} over term · ${aprLabel}`
                  : `${usd(loan?.dayCost ?? 0)} this session · ${aprLabel}`,
            },
            {
              label: 'Loan-to-value',
              value: `${((loan?.ltv ?? 0) * 100).toFixed(0)}%`,
              detail: reserve
                ? `Up to ${usd(limit)} · ${Math.round(reserve.ltv * 100)}% LTV · ${usd(position.available)} free`
                : undefined,
            },
            {
              label: 'Pledge sold at',
              value: loan?.liquidation != null ? usd(loan.liquidation) : '—',
            },
          ],
        }
      : mode === 'short'
        ? {
            eyebrow: 'Protected short',
            label: 'Most this can cost you',
            value: usd(q * (k - price) + protection + interest),
            tone: 'down' as const,
            caption: `Capped at ${usd(k)} a share, protection and interest included.`,
            figures: [
              {
                label: 'You receive / share',
                value: usd(price),
                detail: `${usd(mul(q, price))} total`,
              },
              {
                label: 'Protection / share',
                value: usd(protectionEach),
                detail: `${usd(protection)} total`,
              },
              {
                label: 'Interest / share',
                value: usd(interestEach),
                detail: `${usd(interest)} max · ${stockAprLabel}`,
              },
            ],
          }
        : mode === 'lend'
          ? {
              eyebrow: 'Stock loan',
              label: 'You earn, paid at signing',
              value: usd(interest),
              tone: 'up' as const,
              caption: `For lending ${qty(q)} ${symbol} until ${expiryLabel(end)}.`,
              figures: [
                {
                  label: 'Interest / share',
                  value: usd(interestEach),
                  detail: `${usd(interest)} total · ${stockAprLabel}`,
                },
                {
                  label: 'Borrower posts / share',
                  value: usd(price * 1.5),
                  detail: `${usd(q * price * 1.5)} collateral`,
                },
                { label: 'Term ends', value: expiryLabel(end) },
              ],
            }
          : {
              eyebrow: 'Spot trade',
              label: side === 'buy' ? 'You pay' : 'You receive',
              value: usd(q * fill),
              tone: undefined,
              caption: `Fills at the ${side === 'buy' ? 'ask' : 'bid'}, fully funded from the vault. Settles now.`,
              figures: [
                { label: 'Bid', value: usd(bid) },
                { label: 'Ask', value: usd(ask) },
                { label: 'Shares', value: qty(q) },
              ],
            };

  return (
    <div className="od-borrow">
      <div className="od-stack">
        <section className="od-read">
          <span className="od-read-eyebrow">{read.eyebrow}</span>
          <span className="od-read-label">{read.label}</span>
          <b className={read.tone}>{read.value}</b>
          <p>{read.caption}</p>

          <div className="od-figures">
            {read.figures.map((f) => (
              <Stat
                key={f.label}
                label={f.label}
                value={f.value}
                detail={'detail' in f ? f.detail : undefined}
              />
            ))}
          </div>

          {projected && projected.factor < 1.25 && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> That leaves very little room. A move
              against you liquidates the position.
            </p>
          )}
          {mode === 'borrow' && reserve && b > limit && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> Cross-margin room is {usd(limit)}
              {pledgeLimit < position.available
                ? ` (${Math.round(reserve.ltv * 100)}% of this pledge)`
                : ' (portfolio borrow power)'}
              . Pledge more or draw at most {usd(limit)}.
            </p>
          )}
          {noBook && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> {symbol} has no fresh quote right now,
              so spot orders are paused. Options, lending, shorts and loans
              still work.
            </p>
          )}
          {loan && loan.factor < 1.25 && (
            <p className="od-error" role="alert">
              <TriangleAlert size={13} /> That leaves very little room. A move
              against you sells the pledge.
            </p>
          )}
        </section>

        {reserve && (
          <section className="od-pool">
            <div className="od-pool-rates">
              <div className="od-stat">
                <span>Borrow</span>
                <strong className="down">
                  {(here.borrow * 100).toFixed(2)}%
                </strong>
              </div>
              <div className="od-stat">
                <span>Supply</span>
                <strong className="up">
                  {(here.supply * 100).toFixed(2)}%
                </strong>
              </div>
              <p>
                {(utilisation * 100).toFixed(0)}% of the {symbol} pool is out.{' '}
                {qty(pool?.supplied ?? 0)} supplied, {qty(pool?.borrowed ?? 0)}{' '}
                borrowed
                {pool?.source === 'simulated' ? ', simulated depth.' : '.'}
              </p>
            </div>
            <RateCurve
              curve={curve}
              at={{ ...here, u: utilisation }}
              optimal={reserve.optimal}
            />
          </section>
        )}
      </div>

      <Panel className="od-ticket od-lend-ticket">
        <PanelHead title="Your terms" />
        <div className="od-panel-body">
          <Segmented
            label="Lending action"
            value={mode}
            onChange={(m) => onMode(m)}
            options={[
              { id: 'lend', label: 'Lend' },
              { id: 'borrow', label: 'Borrow' },
              { id: 'short', label: 'Short' },
              { id: 'stock', label: 'Spot' },
            ]}
          />
          <Field label="Underlying">
            <AssetPicker
              value={symbol}
              onChange={onSymbol}
              options={underlyings.map((u) => ({
                id: u.symbol,
                name: u.name,
                symbol: u.symbol,
                price: usd(markOf(s, feed, u.symbol)?.price ?? u.price),
                detail: 'Pool reference',
              }))}
            />
          </Field>
          <Field
            label={mode === 'borrow' ? 'Shares pledged' : 'Shares'}
            hint={`Available ${qty(s.risk.freeShares[symbol] ?? 0)} ${symbol}`}
          >
            <input
              type="number"
              min="0.000001"
              max="1000"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>

          {mode === 'borrow' && (
            <Field
              label="Borrow"
              hint={
                reserve
                  ? `Up to ${usd(limit)} USDC · ${usd(position.available)} free`
                  : undefined
              }
            >
              <input
                aria-label="Borrow amount"
                type="number"
                min="0.000001"
                max={limit || undefined}
                step="any"
                value={amount_}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}

          {mode === 'borrow' && (
            <div className="od-lend-rate">
              <div className="od-field-top">
                <span className="od-lend-rate-label">Rate</span>
                <span className="od-field-hint">
                  {rateKind === 'variable' ? 'Open-ended' : 'Locked term'}
                </span>
              </div>
              <Segmented
                label="Rate"
                value={rateKind}
                onChange={setRateKind}
                options={[
                  {
                    id: 'variable',
                    label: 'Variable',
                    hint: 'Open-ended · repriced each session off the pool',
                  },
                  {
                    id: 'fixed',
                    label: 'Fixed',
                    hint: 'Locked APR until a chosen term end',
                  },
                ]}
              />
              <p className="od-lend-rate-note">
                {rateKind === 'variable'
                  ? `${aprLabel} today. No fixed expiry — repay anytime; the rate moves with the ${symbol} pool.`
                  : `${aprLabel} locked until the term ends. Interest is known at signing.`}
              </p>
            </div>
          )}

          {mode === 'stock' ? (
            <Field label="Direction">
              <Segmented
                label="Spot direction"
                value={side}
                onChange={setSide}
                options={[
                  { id: 'buy', label: 'Buy' },
                  { id: 'sell', label: 'Sell' },
                ]}
              />
            </Field>
          ) : mode === 'borrow' && rateKind === 'variable' ? (
            <output className="od-lend-open">
              <span>Term</span>
              <strong>Open-ended</strong>
              <p>Variable rate · no fixed expiry · repay when you choose</p>
            </output>
          ) : termed ? (
            <Field
              label={
                mode === 'borrow'
                  ? 'Fixed until'
                  : mode === 'short'
                    ? 'Short covers through'
                    : 'Term ends'
              }
              hint={
                mode === 'lend'
                  ? stockAprLabel
                  : mode === 'short'
                    ? 'Protection scales with tenor'
                    : aprLabel
              }
            >
              <ExpiryPicker
                label=""
                ariaLabel={
                  mode === 'borrow'
                    ? 'Fixed until'
                    : mode === 'short'
                      ? 'Covers through'
                      : 'Term ends'
                }
                dates={future}
                value={end}
                asOf={s.book.date}
                onChange={setExpiry}
                headLabel={
                  mode === 'borrow'
                    ? 'Fixed terms'
                    : mode === 'short'
                      ? 'Short tenors'
                      : 'Loan terms'
                }
                nearLabel="Near term"
                laterLabel="Later dates"
                detailOf={(date) => {
                  if (mode === 'lend')
                    return usd(termInterest(1, price, s.book.date, date));
                  if (mode === 'short') {
                    const i = termInterest(1, price, s.book.date, date);
                    const p = protectionPremium(
                      1,
                      price,
                      k,
                      s.book.date,
                      date,
                      volatility,
                    );
                    return usd(add(i, p));
                  }
                  if (mode === 'borrow' && b > 0 && q > 0)
                    return usd(
                      borrowInterest(b, apr, s.book.date, date) / q,
                      4,
                    );
                  return undefined;
                }}
              />
            </Field>
          ) : null}

          {mode === 'short' && (
            <Field
              label="Repurchase cap"
              hint={`${((k / price - 1) * 100).toFixed(1)}% above spot`}
            >
              <input
                aria-label="Protective call strike"
                type="number"
                step="any"
                min={price + 0.01}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </Field>
          )}

          {ticketPrice && (
            <div className="od-lend-price" aria-live="polite">
              <div className="od-lend-price-main">
                <span>{ticketPrice.label}</span>
                <strong>{ticketPrice.each}</strong>
                <small>per share</small>
              </div>
              <div className="od-lend-price-side">
                <span>
                  Total · {qty(q)} {symbol}
                </span>
                <b>{ticketPrice.total}</b>
                <small>{ticketPrice.note}</small>
              </div>
            </div>
          )}

          <Button
            size="lg"
            full
            disabled={!valid || desk.busy}
            onClick={openReview}
          >
            Review{' '}
            {mode === 'lend'
              ? 'stock loan'
              : mode === 'short'
                ? 'protected short'
                : mode === 'borrow'
                  ? 'cash loan'
                  : 'stock trade'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </Panel>

      {review && (
        <Modal
          title={review.title}
          description={`${qty(q)} ${symbol} at ${usd(mode === 'stock' ? fill : price)}${live ? '' : ', the stored reference'}`}
          onClose={() => setReview(null)}
        >
          <div className="od-lines">
            <Line label={review.label} value={usd(review.value)} />
            {review.details.map(([label, value]) => (
              <Line key={label} label={label} value={value} />
            ))}
          </div>
          {review.revision !== s.revision && (
            <p className="od-error" role="alert">
              Your vault changed. Close this review and check the current terms.
            </p>
          )}
          <p className="od-note">
            {mode === 'borrow'
              ? 'The pledge stays in your vault and is released when you repay.'
              : 'Pledged protection cannot be reused. The transaction either updates every balance and reserve together or rolls back entirely, and the backend validates the amounts again.'}
          </p>
          <Button
            size="lg"
            full
            disabled={desk.busy || review.revision !== s.revision}
            onClick={() => void confirm()}
          >
            {desk.busy ? 'Confirming…' : 'Confirm transaction'}
          </Button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
