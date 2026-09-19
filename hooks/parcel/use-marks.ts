'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * The live mark feed, as the desk sees it.
 *
 * Polling rather than a socket: the payload is two kilobytes, the
 * server is same-origin, and a poll survives a sleeping laptop and a
 * restarted backend without any reconnect logic to get wrong. The
 * interval stops while the tab is hidden, so a desk left open in a
 * background tab is not asking for a price four times a second.
 */

export type MarkSource = 'pyth' | 'coinbase' | 'simulated';

export interface Mark {
  symbol: string;
  name: string;
  kind: 'equity' | 'crypto' | 'stable' | 'private';
  price: number;
  open: number;
  change: number;
  bid: number;
  ask: number;
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
  ready: false,
};

const POLL_MS = 2000;

export function useMarks(): MarkFeed {
  const [feed, setFeed] = useState<MarkFeed>(EMPTY);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/marks', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const body = (await res.json()) as {
          asOf: number;
          connected: boolean;
          marks: Mark[];
          tape: Print[];
          minted: number;
          burned: number;
        };
        if (!alive) return;
        loaded = true;
        setFeed({
          asOf: body.asOf,
          connected: body.connected,
          marks: Object.fromEntries(body.marks.map((m) => [m.symbol, m])),
          list: body.marks,
          tape: body.tape,
          minted: body.minted,
          burned: body.burned,
          ready: true,
        });
      } catch {
        /* a missed poll is a missed frame, not an error state */
      }
    };

    /**
     * Polling pauses while the tab is hidden, but the first read always
     * happens. A desk restored into a background tab used to render
     * with no marks at all and stay that way until it was clicked,
     * because the very first poll was skipped along with the rest.
     */
    const tick = async () => {
      if (!document.hidden || !loaded) await poll();
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };

    const wake = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
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
