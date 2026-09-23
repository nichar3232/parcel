'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Button, Line, Modal } from './shared';

interface AgentKey {
  id: string;
  hint: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const when = (t: number | null) =>
  t
    ? new Date(t).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'never';

/**
 * Connects an agent to this vault. A key is created here, shown once, and
 * sent by the agent as a bearer token to the app's own /mcp endpoint, so
 * nothing needs installing. What the agent places is labelled in Activity.
 */
export function AgentsDialog({
  csrf,
  mode,
  onClose,
}: {
  csrf: string;
  mode: string;
  onClose: () => void;
}) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [fresh, setFresh] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const endpoint =
    typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`;
  const command = fresh
    ? `claude mcp add --transport http parcel ${endpoint} --header "Authorization: Bearer ${fresh.key}"`
    : '';

  useEffect(() => {
    api<{ keys: AgentKey[] }>('/api/agent/keys')
      .then((r) => setKeys(r.keys))
      .catch((e: Error) => setError(e.message));
  }, []);

  const post = async (url: string) => {
    setBusy(true);
    setError('');
    try {
      return await api<{
        key?: string;
        agentKey?: AgentKey;
        keys?: AgentKey[];
      }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: '{}',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const r = await post('/api/agent/keys');
    if (!r?.key || !r.agentKey) return;
    setFresh({ id: r.agentKey.id, key: r.key });
    setCopied(false);
    const list = await api<{ keys: AgentKey[] }>('/api/agent/keys');
    setKeys(list.keys);
  };

  const revoke = async (id: string) => {
    const r = await post(`/api/agent/keys/${id}/revoke`);
    if (!r?.keys) return;
    setKeys(r.keys);
    // A revoked key's command no longer works, so stop offering it.
    if (fresh?.id === id) setFresh(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setError('Copying was blocked. Select the command and copy it by hand.');
    }
  };

  return (
    <Modal
      title="Connect an agent"
      description="Let Claude, or any MCP client, trade this vault through the same checks the desk runs."
      onClose={onClose}
      wide
    >
      <p className="od-note">
        {mode === 'sandbox'
          ? 'This vault runs in the sandbox ledger, so an agent’s trades are recorded here, not onchain.'
          : `This vault settles on ${mode}. Every action an agent places is a signed transaction, returned with its signature.`}{' '}
        Trades an agent places are labelled Agent in Activity.
      </p>

      {fresh ? (
        <div className="od-agent-fresh">
          <p className="od-note">
            Run this where your agent lives. The key is shown only now; anyone
            holding it can trade this vault until you revoke it.
          </p>
          <pre className="od-agent-command">
            <code>{command}</code>
          </pre>
          <p className="od-agent-hint">
            Any other MCP client works with the same URL and Authorization
            header.
          </p>
          <div className="od-modal-actions">
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy command'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="od-lines" aria-label="Agent keys">
        {keys === null ? (
          <Line label="Agent keys" value="Loading" tone="muted" />
        ) : keys.length ? (
          keys.map((k) => (
            <div className="od-line od-agent-key" key={k.id}>
              <span>
                Key ending {k.hint}
                <small>
                  Created {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                </small>
              </span>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => revoke(k.id)}
              >
                Revoke
              </Button>
            </div>
          ))
        ) : (
          <Line label="Agent keys" value="None yet" tone="muted" />
        )}
      </div>

      {error && <p className="od-note od-agent-error">{error}</p>}

      <div className="od-modal-actions">
        <Button
          onClick={create}
          disabled={busy || keys === null || keys.length >= 5}
        >
          {keys && keys.length >= 5
            ? 'Five keys is the limit'
            : 'Create agent key'}
        </Button>
      </div>
    </Modal>
  );
}
