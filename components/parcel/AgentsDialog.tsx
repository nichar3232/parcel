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

type App = 'claude' | 'codex' | 'claude-code' | 'other';

/**
 * How each app adds a remote MCP server. Every one of them ends on Parcel's
 * Allow page; a command, where there is one, is only the way in.
 */
const GUIDES: Record<
  App,
  (
    url: string,
    address: React.ReactNode,
  ) => { steps: React.ReactNode[]; command?: string; web?: boolean }
> = {
  claude: (_url, address) => ({
    web: true,
    steps: [
      <>
        In Claude, open <b>Settings → Connectors</b> and choose{' '}
        <b>Add custom connector</b>.
      </>,
      <>Name it Parcel and paste Parcel’s address: {address}.</>,
      <>
        Click <b>Connect</b>, then <b>Allow</b> on the Parcel page that opens.
      </>,
    ],
  }),
  codex: (url) => ({
    command: `codex mcp add parcel --url ${url}`,
    steps: [
      <>Run this in a terminal.</>,
      <>
        Codex opens the Parcel page in your browser. Click <b>Allow</b>.
      </>,
    ],
  }),
  'claude-code': (url) => ({
    command: `claude mcp add --transport http parcel ${url}`,
    steps: [
      <>Run this in a terminal.</>,
      <>
        In Claude Code, type <b>/mcp</b>, choose parcel, then{' '}
        <b>Authenticate</b> and click <b>Allow</b>.
      </>,
    ],
  }),
  other: (_url, address) => ({
    steps: [
      <>
        Add Parcel’s address as a remote (streamable HTTP) MCP server: {address}
        .
      </>,
      <>
        When the app opens the Parcel page, click <b>Allow</b>.
      </>,
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

  const guide = GUIDES[app](
    server,
    <button
      type="button"
      className="od-agent-copy"
      onClick={() => void copy('url', server)}
    >
      {copied === 'url' ? 'copied' : 'copy address'}
    </button>,
  );

  return (
    <Modal
      title="Connect an agent"
      description="Let Claude, Codex or any MCP app use your vault."
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
          { id: 'claude-code', label: 'Claude Code' },
          { id: 'other', label: 'Other' },
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
      {local && guide.web && (
        <p className="od-agent-hint">
          Claude connects from the internet, so it needs Parcel at a public
          https address. Codex and Claude Code connect from this computer.
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

      {error && <p className="od-note od-agent-error">{error}</p>}
    </Modal>
  );
}
