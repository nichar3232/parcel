'use client';

import { useEffect, useMemo, useState } from 'react';

export type TokenizedEquityProvider = 'xstocks' | 'superstate' | 'ondo';

export interface TokenizedEquityAsset {
  id: string;
  provider: TokenizedEquityProvider;
  providerName: string;
  symbol: string;
  name: string;
  underlyingSymbol: string;
  underlyingType: 'Equity' | 'ETF' | null;
  logo: string | null;
  description: string | null;
  mint: string;
  isTradingHalted: boolean;
  marketOpen: boolean | null;
  nextChangeAt: string | null;
}

export interface TokenizedEquityQuote {
  id: string;
  quote: number | null;
  observedAt: number | null;
  receivedAt: number | null;
  state: 'live' | 'unavailable' | 'pending';
  provider: TokenizedEquityProvider;
}

export interface TokenizedEquitySource {
  id: TokenizedEquityProvider;
  name: string;
  state: 'live' | 'unavailable' | 'not-configured';
  assets: number;
  detail: string;
}

export interface TokenizedEquityCatalog {
  assets: TokenizedEquityAsset[];
  sources: TokenizedEquitySource[];
  refreshedAt: number;
}

const CATALOG_POLL_MS = 15 * 60_000;
// Issuer endpoints are quote snapshots, not event streams. Keep a modest
// cadence for the visible watchlist while preserving the provider timestamp
// (when one exists) separately from Parcel's receipt time.
const QUOTE_POLL_MS = 3_000;

/**
 * Solana equities from issuer-owned registries. A source may be unavailable
 * without preventing the other registries from rendering.
 */
export function useTokenizedEquities() {
  const [data, setData] = useState<TokenizedEquityCatalog | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/tokenized-equities', { cache: 'no-store' })
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error(`${response.status}`)),
        )
        .then((payload: TokenizedEquityCatalog) => {
          if (!live) return;
          setData(payload);
          setError('');
        })
        .catch((reason) => live && setError((reason as Error).message));
    void load();
    const timer = setInterval(load, CATALOG_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return { data, error };
}

/**
 * Polls issuer marks for only the visible symbols. Missing values remain
 * pending or unavailable rather than becoming a modelled quote in the UI.
 */
export function useTokenizedEquityQuotes(ids: readonly string[]) {
  const key = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  const [quotes, setQuotes] = useState<Record<string, TokenizedEquityQuote>>(
    {},
  );

  useEffect(() => {
    if (!key) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/tokenized-equities/quotes?ids=${encodeURIComponent(key)}`,
          { cache: 'no-store' },
        );
        if (!response.ok || !live) return;
        const payload = (await response.json()) as {
          quotes?: TokenizedEquityQuote[];
        };
        if (!live || !Array.isArray(payload.quotes)) return;
        setQuotes(
          Object.fromEntries(payload.quotes.map((quote) => [quote.id, quote])),
        );
      } finally {
        if (live) timer = setTimeout(() => void load(), QUOTE_POLL_MS);
      }
    };
    void load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  return quotes;
}
