'use client';
import type { ApiErrorBody, SessionPortfolio } from '@/lib/contracts/api';
import { initialBook, type Action } from '@/lib/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
export const requestKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    signal: init?.signal || AbortSignal.timeout(20000),
  });
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    throw new RequestError(
      'The server returned an unreadable response. Check the backend connection.',
      'INVALID_RESPONSE',
      r.status,
    );
  }
  if (!r.ok) {
    const e = data as ApiErrorBody;
    throw new RequestError(
      e.error || 'Request failed.',
      e.code || 'REQUEST',
      r.status,
    );
  }
  return data as T;
}
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
