'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * The live mark feed, as the desk sees it.
 *
 * The browser consumes a same-origin Server-Sent Event stream. The server,
 * not every tab, owns the credentialed vendor connection; a slow polling
 * fallback remains for proxies that cannot carry streamed responses.
 */

export type MarkSource =
  | 'massive-nbbo'
  | 'massive-delayed-nbbo'
  | 'pyth'
  | 'coinbase'
  | 'simulated';

export interface Mark {
  symbol: string;
  name: string;
  kind: 'equity' | 'crypto' | 'stable' | 'private';
  price: number;
  open: number;
  change: number;
  bid: number;
  ask: number;
  quoteKind: 'nbbo' | 'venue-bbo' | 'modelled';
  spreadBps: number;
  vol: number;
  source: MarkSource;
  observedAt: number | null;
  /** Mock-token supply the maker has minted against this instrument. */
  supply: number;
  /** The lending pool the rate curve is derived from. */
  supplied: number;
  borrowed: number;
  utilisation: number;
}

export interface Print {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  at: number;
  effect: 'mint' | 'burn';
}

export interface MarkFeed {
  asOf: number;
  connected: boolean;
  marks: Record<string, Mark>;
  list: Mark[];
  tape: Print[];
  minted: number;
  burned: number;
  sources: Array<{
    name: string;
    enabled: boolean;
    state: 'disabled' | 'connecting' | 'live' | 'degraded';
    detail: string;
  }>;
  /** Set once a poll has completed, so the UI can hold its shape. */
  ready: boolean;
}

const EMPTY: MarkFeed = {
  asOf: 0,
  connected: false,
  marks: {},
  list: [],
  tape: [],
  minted: 0,
  burned: 0,
  sources: [],
  ready: false,
};

const FALLBACK_POLL_MS = 5000;

export function useMarks(): MarkFeed {
  const [feed, setFeed] = useState<MarkFeed>(EMPTY);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: EventSource | null = null;
    let loaded = false;
    let polling = false;

    type Payload = {
      asOf: number;
      connected: boolean;
      marks: Mark[];
      tape: Print[];
      minted: number;
      burned: number;
      sources?: MarkFeed['sources'];
    };

    const accept = (body: Payload) => {
      if (!alive || !Array.isArray(body.marks)) return;
      loaded = true;
      setFeed({
        asOf: body.asOf,
        connected: body.connected,
        marks: Object.fromEntries(body.marks.map((m) => [m.symbol, m])),
        list: body.marks,
        tape: body.tape,
        minted: body.minted,
        burned: body.burned,
        sources: body.sources ?? [],
        ready: true,
      });
    };

    const poll = async () => {
      try {
        const res = await fetch('/api/marks', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        accept((await res.json()) as Payload);
      } catch {
        /* a missed poll is a missed frame, not an error state */
      }
    };

    const startPolling = () => {
      if (polling || !alive) return;
      polling = true;
      const tick = async () => {
        if (!document.hidden || !loaded) await poll();
        if (alive && polling)
          timer = setTimeout(() => void tick(), FALLBACK_POLL_MS);
      };
      void tick();
    };

    /**
     * The server owns one upstream connection and fans marks out through SSE.
     * EventSource reconnects on brief network interruptions; a deliberately
     * slower polling fallback keeps the desk usable behind a proxy that does
     * not support streaming responses.
     */
    if (typeof EventSource !== 'undefined') {
      stream = new EventSource('/api/marks/stream');
      stream.addEventListener('marks', (event) => {
        try {
          accept(JSON.parse((event as MessageEvent<string>).data) as Payload);
        } catch {
          /* Wait for the next complete snapshot. */
        }
      });
      stream.onerror = () => {
        // Native EventSource attempts to reconnect itself. Keep the fallback
        // available only until a stream event arrives, avoiding duplicate
        // traffic while a healthy stream is running.
        if (!loaded) startPolling();
      };
      // A middlebox can leave a stream half-open without sending its opening
      // snapshot. Do not leave the first render empty in that case.
      timer = setTimeout(() => {
        if (!loaded) startPolling();
      }, 1500);
    } else {
      startPolling();
    }

    const wake = () => {
      if (document.hidden) return;
      // A fallback poll may be waiting for a hidden tab's next interval.
      // Read once on focus without cancelling its existing schedule.
      if (polling) void poll();
    };

    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      polling = false;
      if (timer) clearTimeout(timer);
      stream?.close();
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);

  return feed;
}

/**
 * A price that flashes when it moves.
 *
 * Returns the direction of the last change for a short window, which is
 * the whole reason a tape is readable at a glance: the eye catches the
 * flash long before it reads the digits.
 */
export function useFlash(value: number, ms = 600) {
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (value === previous.current) return;
    setDir(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const t = setTimeout(() => setDir(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dir;
}
