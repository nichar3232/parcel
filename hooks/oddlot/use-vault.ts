'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OrderTerms,
  Quote,
  VaultAction,
  VaultSnapshot,
} from '@/lib/oddlot/types';
import { api, requestKey, RequestError } from '@/hooks/desk/use-portfolio';
export function useVault() {
  const [state, setState] = useState<VaultSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const current = useRef<VaultSnapshot | null>(null),
    lock = useRef(false);
  const update = useCallback((value: VaultSnapshot) => {
    if (
      !current.current ||
      value.csrf !== current.current.csrf ||
      value.revision >= current.current.revision
    ) {
      current.current = value;
      setState(value);
    }
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    try {
      await api('/api/session');
      update(await api<VaultSnapshot>('/api/vault'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [update]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function post<T>(url: string, body: unknown): Promise<T> {
    if (!current.current) throw Error('Connect to your vault first.');
    const key = requestKey();
    const send = () =>
      api<T>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': current.current!.csrf,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
    try {
      return await send();
    } catch (e) {
      if (e instanceof RequestError) throw e;
      return await send();
    }
  }
  async function act(action: VaultAction) {
    if (lock.current || !current.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      update(
        await post<VaultSnapshot>('/api/vault/actions', {
          revision: current.current.revision,
          action,
        }),
      );
      setToast('Vault updated. Balances and collateral verified.');
      return true;
    } catch (e) {
      setToast((e as Error).message);
      await refresh();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function quote(terms: OrderTerms) {
    if (!current.current) throw Error('Connect to your vault first.');
    return post<Quote>('/api/vault/quote', {
      revision: current.current.revision,
      terms,
    });
  }
  return { state, busy, error, toast, setToast, refresh, act, quote };
}
export type VaultController = ReturnType<typeof useVault>;
