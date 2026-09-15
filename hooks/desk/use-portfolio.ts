'use client';
import type { SessionPortfolio } from '@/lib/contracts/api';
import { initialBook, type Action } from '@/lib/engine';
import { api, requestKey, RequestError } from '@/lib/client/api';
import { useCallback, useEffect, useRef, useState } from 'react';
export function usePortfolio(notify: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<SessionPortfolio | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const current = useRef<SessionPortfolio | null>(null),
    lock = useRef(false);
  const update = useCallback((value: SessionPortfolio) => {
    if (
      !current.current ||
      value.csrf !== current.current.csrf ||
      value.revision >= current.current.revision
    ) {
      current.current = value;
      setSnapshot(value);
    }
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    try {
      update(await api<SessionPortfolio>('/api/session'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [update]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  async function act(action: Action | { type: 'reset' }) {
    if (lock.current) {
      notify('Wait for the current portfolio action to finish.');
      return false;
    }
    if (!current.current) {
      notify('The backend session is not ready. Reconnect before trading.');
      return false;
    }
    lock.current = true;
    setBusy(true);
    const request = { revision: current.current.revision, action },
      key = requestKey();
    const send = () =>
      api<SessionPortfolio>('/api/portfolio/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': current.current!.csrf,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(request),
      });
    try {
      let value: SessionPortfolio;
      try {
        value = await send();
      } catch (e) {
        if (e instanceof RequestError) throw e;
        value = await send();
      }
      update(value);
      return true;
    } catch (e) {
      notify((e as Error).message);
      await refresh();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    book: snapshot?.book || initialBook(),
    ready: !!snapshot,
    busy,
    error,
    refresh,
    act,
    csrf: snapshot?.csrf || '',
  };
}
