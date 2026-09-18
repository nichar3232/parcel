'use client';
import { useEffect, useState } from 'react';
import type { ResolvedAsset } from '@/lib/preipo/types';

export interface AssetsPayload {
  network: string;
  programId: string | null;
  usdcMint: string | null;
  executionEnabled: boolean;
  assets: ResolvedAsset[];
  warnings: string[];
  refreshedAt: string;
}

/** The company, without the provider's naming attached to it. */
export const company = (displayName: string) =>
  displayName.replace(/^Tessera T-/, '').replace(/ PreStocks$/, '');

/**
 * The verified pre-IPO registry, as the server serves it.
 *
 * Shared by the Pre-IPO market and the portfolio's market strip, so
 * both read the same list and the same marks. Loading it also seeds
 * each token's mark in the engine, which is why the strip can quote a
 * private company at all.
 */
export function usePreIpoAssets() {
  const [data, setData] = useState<AssetsPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/preipo/assets')
        .then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        )
        .then((d: AssetsPayload) => live && setData(d))
        .catch((e) => live && setError((e as Error).message));
    void load();
    // The providers republish a mark on their own clock; re-reading keeps
    // the mock tokens anchored to it rather than drifting all session.
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return { data, error };
}
