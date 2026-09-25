'use client';
import type { ChainEvidence, ChainPosition, Health } from '@/lib/contracts/api';
import type { Terms } from '@/lib/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, requestKey, RequestError } from '@/lib/client/api';
import { chainDownError, shownWarning } from '@/lib/client/chain-copy';
export function useChain(
  csrf: string,
  terms: Terms,
  missing: boolean,
  notify: (message: string) => void,
) {
  const [remote, setRemote] = useState<ChainPosition | null>(null),
    [remoteBusy, setRemoteBusy] = useState(false),
    [chainReady, setChainReady] = useState(false),
    [evidence, setEvidence] = useState<ChainEvidence | null>(null),
    [chainBusy, setChainBusy] = useState(false),
    [health, setHealth] = useState<Health | null>(null);
  const updateRemote = useCallback(
    (value: ChainPosition | null) =>
      setRemote((current) =>
        current &&
        value &&
        current.id === value.id &&
        current.lastSlot > value.lastSlot
          ? current
          : value,
      ),
    [],
  );
  const lock = useRef(false);
  const pendingRequest = useRef<{ key: string; input: string } | null>(null);
  const storageKey = `strata-pending-${csrf.slice(0, 16)}`;
  useEffect(() => {
    if (!csrf) return;
    try {
      pendingRequest.current = JSON.parse(
        sessionStorage.getItem(storageKey) || 'null',
      ) as { key: string; input: string } | null;
    } catch {
      pendingRequest.current = null;
    }
    void api<ChainPosition[]>('/api/chain/positions')
      .then((p) => {
        updateRemote(p[0] || null);
        setChainReady(true);
      })
      .catch(() => {});
    void api<ChainEvidence>('/api/evidence')
      .then(setEvidence)
      .catch(() => {});
    void api<Health>('/api/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [csrf, storageKey, updateRemote]);
  useEffect(() => {
    if (
      !remote ||
      (!remote.pending &&
        !['funded', 'active', 'awaiting'].includes(remote.status))
    )
      return;
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void api<ChainPosition>(`/api/chain/positions/${remote.id}`)
        .then((value) => {
          if (remote.pending && !value.pending)
            notify(
              shownWarning(value.warning) || 'Transaction confirmed on Solana.',
            );
          updateRemote(value);
        })
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [remote, updateRemote, notify]);
  async function chainAction(action: string) {
    if (lock.current) return;
    if (!csrf) {
      notify('Reconnect the backend session first.');
      return;
    }
    lock.current = true;
    setRemoteBusy(true);
    try {
      const key = pendingRequest.current?.key || requestKey();
      const input =
        pendingRequest.current?.input ||
        JSON.stringify(
          action === 'fund'
            ? { action, terms }
            : { action, id: remote?.id, missing },
        );
      const send = () =>
        api<ChainPosition>('/api/chain/action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Idempotency-Key': key,
          },
          body: input,
        });
      let result: ChainPosition;
      if (action === 'read') {
        setHealth(await api<Health>('/api/health'));
        if (!remote) {
          const positions = await api<ChainPosition[]>('/api/chain/positions');
          updateRemote(positions[0] || null);
          setChainReady(true);
          notify('Chain connection checked.');
          return;
        }
        result = await api<ChainPosition>(`/api/chain/positions/${remote.id}`);
      } else {
        if (!chainReady) throw Error('Wait for your saved contracts to load.');
        pendingRequest.current = { key, input };
        sessionStorage.setItem(
          storageKey,
          JSON.stringify(pendingRequest.current),
        );
        try {
          result = await send();
        } catch (e) {
          if (!(e instanceof RequestError)) result = await send();
          else throw e;
        }
      }
      updateRemote(result);
      pendingRequest.current = null;
      sessionStorage.removeItem(storageKey);
      notify(
        shownWarning(result.warning) ||
          (action === 'read'
            ? 'Live escrow refreshed.'
            : 'Transaction confirmed on Solana.'),
      );
    } catch (e) {
      if (e instanceof RequestError && e.status < 500) {
        pendingRequest.current = null;
        sessionStorage.removeItem(storageKey);
      }
      if (!chainDownError(e)) notify((e as Error).message);
    } finally {
      lock.current = false;
      setRemoteBusy(false);
    }
  }
  async function runChain() {
    setChainBusy(true);
    try {
      setEvidence(await api<ChainEvidence>('/api/evidence'));
      setHealth(await api<Health>('/api/health'));
      notify('Verification evidence refreshed.');
    } catch (e) {
      if (!chainDownError(e)) notify((e as Error).message);
    } finally {
      setChainBusy(false);
    }
  }
  return {
    chainReady,
    remote,
    setRemote,
    remoteBusy: remoteBusy || !!remote?.pending,
    evidence,
    chainBusy,
    health,
    chainAction,
    runChain,
  };
}
