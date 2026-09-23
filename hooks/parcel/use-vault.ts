'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OrderTerms,
  Quote,
  VaultAction,
  VaultSnapshot,
} from '@/lib/parcel/types';
import type { ChainCatalog, SizeResult } from '@/lib/parcel/types';
import { api, requestKey, ambiguousResponse } from '@/lib/client/api';
import {
  clearPending,
  loadPending,
  savePending,
  type PendingMutation,
} from '@/lib/client/pending-vault';

/**
 * Receipts are durable, while the snapshot shape evolves with the desk. A
 * retry can therefore return a valid older receipt that predates a newly
 * added display field. Keep the client-side contract total while the server
 * refreshes it, rather than allowing one omitted array to take down a view.
 */
function completeSnapshot(
  value: VaultSnapshot,
  previous: VaultSnapshot['market']['underlyings'] = [],
): VaultSnapshot {
  const underlyings = value.market?.underlyings;
  // Treat an empty legacy list the same as an omitted one. A receipt may
  // have been persisted during a deploy that knew the field but could not
  // populate it; retaining the last complete catalog keeps the ticket
  // usable until the following refresh replaces it with the server truth.
  if (Array.isArray(underlyings) && underlyings.length) return value;
  return {
    ...value,
    market: {
      ...value.market,
      underlyings: previous.length ? previous : (underlyings ?? []),
    },
  };
}

export function useVault() {
  const [state, setState] = useState<VaultSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const current = useRef<VaultSnapshot | null>(null),
    lock = useRef(false),
    pendingRequest = useRef<PendingMutation | null>(null),
    refreshSequence = useRef(0);
  const update = useCallback((value: VaultSnapshot) => {
    const snapshot = completeSnapshot(
      value,
      current.current?.market.underlyings,
    );
    if (current.current && snapshot.csrf !== current.current.csrf) return;
    if (!current.current || snapshot.revision >= current.current.revision) {
      current.current = snapshot;
      setState(snapshot);
    }
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      await api('/api/session');
      const value = await api<VaultSnapshot>('/api/vault');
      if (sequence !== refreshSequence.current) return;
      if (!current.current || current.current.csrf !== value.csrf) {
        // A session change is accepted only through the latest explicit refresh,
        // never through a delayed mutation response from an older account.
        current.current = null;
        pendingRequest.current = loadPending(value.csrf);
        setPending(!!pendingRequest.current);
      }
      update(value);
    } catch (e) {
      if (sequence === refreshSequence.current) setError((e as Error).message);
    }
  }, [update]);
  const cancelRefresh = useCallback(() => {
    refreshSequence.current++;
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('focus', focus);
      cancelRefresh();
    };
  }, [refresh, cancelRefresh]);
  // On the live market contracts settle on the wall clock, so an open
  // desk reads the vault again every minute rather than only on focus.
  const live = state?.market.clock === 'live';
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (!document.hidden && !lock.current) void refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [live, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function post<T>(url: string, request: PendingMutation): Promise<T> {
    const send = () => {
      if (current.current?.csrf !== request.csrf)
        throw Error('Your session changed. Reconnect before continuing.');
      return api<T>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': request.csrf,
          'Idempotency-Key': request.key,
        },
        body: request.input,
      });
    };
    try {
      return await send();
    } catch (e) {
      if (!ambiguousResponse(e)) throw e;
      return await send();
    }
  }
  async function resolve(request: PendingMutation) {
    lock.current = true;
    setBusy(true);
    try {
      const result = await post<VaultSnapshot>('/api/vault/actions', request);
      clearPending(request.csrf);
      if (current.current?.csrf !== request.csrf) return false;
      pendingRequest.current = null;
      setPending(false);
      update(result);
      setToast('Vault updated. Balances and collateral verified.');
      return true;
    } catch (e) {
      if (current.current?.csrf === request.csrf) {
        if (!ambiguousResponse(e)) {
          clearPending(request.csrf);
          pendingRequest.current = null;
          setPending(false);
        }
        setToast(
          ambiguousResponse(e)
            ? 'Confirmation is pending. Resolve the saved action before making another change.'
            : (e as Error).message,
        );
      }
      await refresh();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function act(
    action: VaultAction,
    reviewedRevision = current.current?.revision,
  ) {
    if (lock.current || !current.current) return false;
    if (pendingRequest.current) {
      setToast('Resolve the saved action before making another change.');
      return false;
    }
    const request = {
      csrf: current.current.csrf,
      key: requestKey(),
      input: JSON.stringify({ revision: reviewedRevision, action }),
    };
    try {
      savePending(request);
    } catch {
      setToast(
        'Browser recovery storage is unavailable. Enable it before changing the vault.',
      );
      return false;
    }
    pendingRequest.current = request;
    setPending(true);
    return resolve(request);
  }
  async function recover() {
    if (lock.current || !pendingRequest.current) return false;
    return resolve(pendingRequest.current);
  }
  async function quote(terms: OrderTerms) {
    if (!current.current) throw Error('Connect to your vault first.');
    if (pendingRequest.current)
      throw Error('Resolve the saved action before requesting a quote.');
    const started = performance.now();
    const result = await post<Quote>('/api/vault/quote', {
      csrf: current.current.csrf,
      key: requestKey(),
      input: JSON.stringify({ revision: current.current.revision, terms }),
    });
    return {
      ...result,
      reviewDeadline: started + result.expiresAt - result.issuedAt,
    };
  }
  async function closeQuote(positionId: string) {
    if (!current.current || pendingRequest.current)
      throw Error('Resolve pending actions and connect to your vault first.');
    const started = performance.now();
    const result = await post<Quote>('/api/vault/quote', {
      csrf: current.current.csrf,
      key: requestKey(),
      input: JSON.stringify({ revision: current.current.revision, positionId }),
    });
    return {
      ...result,
      reviewDeadline: started + result.expiresAt - result.issuedAt,
    };
  }
  async function catalog<T>(path: string, body: Record<string, unknown>) {
    if (!current.current || pendingRequest.current)
      throw Error('Resolve pending actions and connect first.');
    return post<T>(path, {
      csrf: current.current.csrf,
      key: requestKey(),
      input: JSON.stringify({ ...body, revision: current.current.revision }),
    });
  }
  return {
    chain: (expiry: string, quantity: number, symbol?: string) =>
      catalog<ChainCatalog>('/api/vault/chain', { expiry, quantity, symbol }),
    size: (terms: OrderTerms, mode: string, target: number) =>
      catalog<SizeResult>('/api/vault/size', { terms, mode, target }),
    closeQuote,
    state,
    busy,
    pending,
    error,
    toast,
    setToast,
    refresh,
    act,
    quote,
    recover,
  };
}
export type VaultController = ReturnType<typeof useVault>;
