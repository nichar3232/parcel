'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Button, Modal, Segmented } from './shared';

interface AgentKey {
  id: string;
  hint: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

type App = 'claude' | 'codex';

interface Place {
  /** Parcel's agent address. */
  url: string;
  /** An inline control that copies it. */
  address: React.ReactNode;
  /** The desk runs on this computer, out of reach of Claude's app. */
  local: boolean;
}

/**
 * How each app connects. Every one ends on Parcel's Allow page; a command,
 * where there is one, is only the way in. Claude's app calls in from the
 * internet, so a desk on this computer is reached from Claude Code, which
 * also brings /parcel.
 */
const GUIDES: Record<
  App,
  (p: Place) => { steps: React.ReactNode[]; command?: string }
> = {
  claude: ({ url, address, local }) =>
    local
      ? {
          command: `curl -fsSL ${url.replace(/\/mcp$/, '')}/claude/install | sh`,
          steps: [
            <>Paste this into a terminal.</>,
            <>
              In Claude Code, type <b>/mcp</b>, pick <b>parcel</b>, choose{' '}
              <b>Authenticate</b>, then click <b>Allow</b>.
            </>,
            <>
              Type <b>/parcel</b> and ask for anything: your balance, a trade, a
              loan.
            </>,
          ],
        }
      : {
          steps: [
            <>
              In Claude, open <b>Settings → Connectors</b> and choose{' '}
              <b>Add custom connector</b>.
            </>,
            <>Name it Parcel and paste Parcel’s address: {address}.</>,
            <>
              Click <b>Connect</b>, then <b>Allow</b> on the Parcel page that
              opens.
            </>,
          ],
        },
  codex: ({ url }) => ({
    command: `codex mcp add parcel --url ${url}`,
    steps: [
      <>Paste this into a terminal.</>,
      <>
        Click <b>Allow</b> on the Parcel page that opens.
      </>,
      <>Ask Codex for anything in your vault.</>,
    ],
  }),
};

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
  const [published, setPublished] = useState<string | null>(null);
  const server =
    published ??
    (typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`);
  // Claude's connectors call in from the internet, so a desk with no public
  // address can connect only the apps on this computer.
  const local =
    !published &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const [app, setApp] = useState<App>('claude');

  // Approving happens on another page, so keep the list current while this
  // is open: a connection appears here as soon as it is made.
  useEffect(() => {
    const load = () =>
      api<{ keys: AgentKey[]; mcpUrl: string | null }>('/api/agent/keys')
        .then((r) => {
          setKeys(r.keys);
          setPublished(r.mcpUrl);
        })
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

  const guide = GUIDES[app]({
    url: server,
    address: (
      <button
        type="button"
        className="od-agent-copy"
        onClick={() => void copy('url', server)}
      >
        {copied === 'url' ? 'copied' : 'copy address'}
      </button>
    ),
    local,
  });

  return (
    <Modal
      title="Connect over MCP"
      description="Use your vault from Claude or Codex."
      onClose={onClose}
      wide
    >
      <Segmented
        label="App"
        value={app}
        onChange={(next) => {
          setApp(next);
          setCopied('');
        }}
        options={[
          { id: 'claude', label: 'Claude' },
          { id: 'codex', label: 'Codex' },
        ]}
      />
      {guide.command && (
        <div className="od-agent-url">
          <code>{guide.command}</code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copy('command', guide.command!)}
          >
            {copied === 'command' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'command' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
      <ol className="od-agent-steps">
        {guide.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

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

      {error && <p className="od-note od-agent-error">{error}</p>}
    </Modal>
  );
}
