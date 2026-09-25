'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Button, Modal } from './shared';

interface AgentKey {
  id: string;
  hint: string;
  label: string | null;
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
    : 'not yet';

/**
 * Connects Claude, or any MCP app, the way hosted MCP services do: one URL.
 * The app is sent to Parcel's Allow page, and approving there connects it,
 * so nobody copies a key. Connected apps are listed here and can be cut.
 */
export function AgentsDialog({
  csrf,
  onClose,
}: {
  csrf: string;
  mode: string;
  onClose: () => void;
}) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const server =
    typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`;
  const local =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const code = `claude mcp add --transport http parcel ${server}`;

  // Approving happens on another page, so keep the list current while this
  // is open: a connection appears here as soon as it is made.
  useEffect(() => {
    const load = () =>
      api<{ keys: AgentKey[] }>('/api/agent/keys')
        .then((r) => setKeys(r.keys))
        .catch((e: Error) => setError(e.message));
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const disconnect = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ keys: AgentKey[] }>(
        `/api/agent/keys/${id}/revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: '{}',
        },
      );
      setKeys(r.keys);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setError('Copying was blocked. Select the text and copy it by hand.');
    }
  };

  return (
    <Modal
      title="Connect Claude"
      description="Use Parcel from a chat with Claude."
      onClose={onClose}
      wide
    >
      <div className="od-agent-url">
        <code>{server}</code>
        <Button size="sm" onClick={() => copy('url', server)}>
          {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
          {copied === 'url' ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <ol className="od-agent-steps">
        <li>
          In Claude, open <b>Settings → Connectors</b> and choose{' '}
          <b>Add custom connector</b>.
        </li>
        <li>Name it Parcel and paste the URL above.</li>
        <li>
          Click <b>Connect</b>, then <b>Allow</b> on the Parcel page that opens.
        </li>
      </ol>
      {local && (
        <p className="od-agent-hint">
          Claude reaches connectors over the internet, so this needs Parcel at a
          public https address. On this computer, Claude Code connects directly.
        </p>
      )}

      <div className="od-lines" aria-label="Connected apps">
        {keys === null ? null : keys.length ? (
          keys.map((k) => (
            <div className="od-line od-agent-key" key={k.id}>
              <span>
                {k.label ?? `Key ending ${k.hint}`}
                <small>
                  Connected {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                </small>
              </span>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => disconnect(k.id)}
              >
                Disconnect
              </Button>
            </div>
          ))
        ) : (
          <p className="od-agent-hint">No apps connected yet.</p>
        )}
      </div>

      <details className="od-agent-more">
        <summary>Claude Code</summary>
        <p className="od-agent-hint">
          Run this, then type <b>/mcp</b> in Claude Code and choose Parcel to
          sign in.
        </p>
        <div className="od-agent-url">
          <code>{code}</code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copy('code', code)}
          >
            {copied === 'code' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'code' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </details>

      {error && <p className="od-note od-agent-error">{error}</p>}
    </Modal>
  );
}
