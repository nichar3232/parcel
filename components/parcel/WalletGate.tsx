'use client';
import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Mark } from '@/components/brand/Mark';
import { Button } from './shared';

/** The part of Phantom's injected provider the desk uses. */
interface Phantom {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (
    message: Uint8Array,
    display?: 'utf8',
  ) => Promise<{ signature: Uint8Array }>;
}

export const phantom = (): Phantom | undefined => {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    phantom?: { solana?: Phantom };
    solana?: Phantom;
  };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : undefined;
};

/** w2KT…CsQ */
export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * The desk opens once a wallet signs in. Phantom connects, then signs a
 * one-time message the server checks: a signature, not a transaction, so
 * nothing is sent or spent. The vault and its positions are already there;
 * signing in is what opens them.
 */
export function WalletGate({
  csrf,
  onSignedIn,
}: {
  csrf: string | undefined;
  onSignedIn: (address: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wallet = phantom();

  const signIn = async () => {
    if (!wallet || !csrf) return;
    setBusy(true);
    setError('');
    try {
      const { publicKey } = await wallet.connect();
      const address = publicKey.toString();
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      };
      const { message } = await api<{ message: string }>(
        '/api/wallet/challenge',
        { method: 'POST', headers, body: '{}' },
      );
      const { signature } = await wallet.signMessage(
        new TextEncoder().encode(message),
        'utf8',
      );
      const signed = await api<{ switched: boolean }>('/api/wallet/signin', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          address,
          signature: btoa(String.fromCharCode(...signature)),
        }),
      });
      // This wallet already has a vault: the server moved this browser onto
      // it, so load it fresh.
      if (signed.switched) {
        window.location.reload();
        return;
      }
      onSignedIn(address);
    } catch (e) {
      const text = (e as Error).message || '';
      setError(
        /reject|denied|cancel/i.test(text)
          ? 'Sign-in was cancelled in Phantom.'
          : text || 'Could not sign in.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="od-gate">
      <div className="od-gate-inner">
        <Mark size={36} />
        <h1>Sign in to Parcel</h1>
        <p>Connect your wallet to open your vault.</p>
        {wallet ? (
          <Button size="lg" full onClick={signIn} disabled={busy || !csrf}>
            <Wallet size={16} />
            {busy ? 'Check Phantom…' : 'Connect Phantom'}
          </Button>
        ) : (
          <a
            className="od-gate-install"
            href="https://phantom.app/download"
            target="_blank"
            rel="noreferrer"
          >
            Install Phantom to sign in
          </a>
        )}
        {error && (
          <p className="od-gate-error" role="alert">
            {error}
          </p>
        )}
        <small>
          You sign a message, not a transaction. Nothing is sent or spent.
        </small>
      </div>
    </div>
  );
}
