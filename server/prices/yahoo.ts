import type { Instrument } from './feeds';
import type { Observation, Source, SourceHealth } from './sources';

/**
 * Listed equities, from Yahoo Finance's public chart endpoint.
 *
 * Pyth's equity prices sit behind a key, so without one NVDA never had a
 * real mark and every number built on it stood still. The chart endpoint
 * needs no key and carries pre-market, regular and after-hours prints at
 * one-minute resolution; the last bar's close moves within its minute, so
 * polling it every couple of seconds is as live as a keyless source gets.
 *
 * The same response is the day's intraday series, kept here so the
 * portfolio can draw today from real prints rather than from the moment
 * the page was opened.
 */

const TIMEOUT = 4000;
const HOST = process.env.YAHOO_CHART_URL || 'https://query1.finance.yahoo.com';

export interface IntradayBar {
  /** Bar start, in ms. */
  t: number;
  price: number;
}

export interface Intraday {
  symbol: string;
  /** The last regular-session close before today's session opened. */
  previousClose: number | null;
  /** The last two days of prints, so an early pre-market has context. */
  bars: IntradayBar[];
  /** Where today begins: the start of its pre-market, in ms. */
  dayStart: number | null;
  /** Regular session bounds, in ms, when the venue publishes them. */
  session: { start: number; end: number } | null;
  asOf: number;
}

interface ChartBody {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currentTradingPeriod?: {
          pre?: { start: number; end: number };
          regular?: { start: number; end: number };
        };
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export class YahooSource implements Source {
  readonly name = 'yahoo';
  enabled = true;
  private failures = 0;
  private state: SourceHealth['state'] = 'connecting';
  private detail = 'Reading delayed listed-equity prints';
  private days = new Map<string, Intraday>();

  /** Today's prints for a symbol this source has observed, if any. */
  intraday(symbol: string): Intraday | null {
    return this.days.get(symbol.toUpperCase()) ?? null;
  }

  health(): SourceHealth {
    return {
      name: this.name,
      enabled: this.enabled,
      state: this.state,
      detail: this.detail,
    };
  }

  private async chart(ticker: string): Promise<ChartBody | null> {
    try {
      const res = await fetch(
        `${HOST}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=2d&includePrePost=true`,
        {
          signal: AbortSignal.timeout(TIMEOUT),
          // The endpoint refuses a request with no browser-like agent.
          headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
        },
      );
      return res.ok ? ((await res.json()) as ChartBody) : null;
    } catch {
      return null;
    }
  }

  async observe(instruments: Instrument[]): Promise<Observation[]> {
    if (!this.enabled) return [];
    const wanted = instruments.filter((i) => i.yahoo);
    const rows = await Promise.all(
      wanted.map(async (i): Promise<Observation | null> => {
        const body = await this.chart(i.yahoo!);
        const r = body?.chart?.result?.[0];
        if (!r) return null;
        const closes = r.indicators?.quote?.[0]?.close ?? [];
        const bars: IntradayBar[] = [];
        (r.timestamp ?? []).forEach((ts, n) => {
          const price = closes[n];
          if (price != null && Number.isFinite(price) && price > 0)
            bars.push({ t: ts * 1000, price });
        });
        const last = bars.at(-1);
        const price = last?.price ?? r.meta?.regularMarketPrice;
        if (!price || !Number.isFinite(price) || price <= 0) return null;
        const regular = r.meta?.currentTradingPeriod?.regular;
        const pre = r.meta?.currentTradingPeriod?.pre;
        // Before today's open the venue's "regular market price" is still
        // yesterday's close, which is the reference today's move is
        // measured from; once the session is open it is the live price
        // and the reference is the published previous close.
        const beforeOpen = !regular || Date.now() < regular.start * 1000;
        const previousClose =
          (beforeOpen
            ? r.meta?.regularMarketPrice
            : (r.meta?.previousClose ?? r.meta?.chartPreviousClose)) ?? null;
        this.days.set(i.symbol, {
          symbol: i.symbol,
          previousClose,
          bars,
          dayStart: pre ? pre.start * 1000 : null,
          session: regular
            ? { start: regular.start * 1000, end: regular.end * 1000 }
            : null,
          asOf: Date.now(),
        });
        return {
          symbol: i.symbol,
          price,
          open: previousClose ?? undefined,
          at: last?.t ?? (r.meta?.regularMarketTime ?? 0) * 1000,
          source: this.name,
        };
      }),
    );
    const out = rows.filter((r): r is Observation => !!r);
    this.failures = out.length || !wanted.length ? 0 : this.failures + 1;
    if (out.length) {
      this.state = 'live';
      this.detail = `Yahoo delivering ${out.length} delayed listed-equity mark${out.length === 1 ? '' : 's'}`;
    } else if (!wanted.length) {
      this.state = 'live';
      this.detail = 'No listed-equity symbols requested';
    } else {
      // Public endpoints are routinely rate limited or briefly unavailable.
      // Standing down permanently after ten misses turns a transient outage
      // into a frozen desk until a deploy; stay retryable and tell the UI the
      // source is degraded instead.
      this.state = 'degraded';
      this.detail = `Yahoo returned no current listed-equity marks${this.failures > 1 ? ` (${this.failures} consecutive polls)` : ''}`;
    }
    return out;
  }
}
