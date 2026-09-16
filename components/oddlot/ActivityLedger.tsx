'use client';
import { useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import { Badge, Button, Empty, Panel, qty, usd } from './shared';

/**
 * The full ledger: chain proof, searchable history and JSON export.
 * Rendered inside the vault rather than behind its own tab.
 */
export function ActivityLedger({ desk }: { desk: VaultController }) {
  const s = desk.state!,
    [search, setSearch] = useState('');
  const rows = s.book.events.filter((e) =>
    `${e.title} ${e.detail} ${e.date}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const download = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              revision: s.revision,
              mode: s.mode,
              chain: s.chain,
              book: s.book,
              risk: s.risk,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oddlot-vault-ledger.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      {s.chain && (
        <Panel className="od-chain-proof">
          <div className="od-panel-heading">
            <h2>Confirmed on Solana localnet</h2>
            <Badge>Revision {s.chain.revision}</Badge>
          </div>
          <div className="od-proof-body">
            <p className="od-form-note">
              Program execution and SPL test-token backing verified at slot{' '}
              {s.chain.slot}. Private validator · test assets.
            </p>
            <details>
              <summary>
                Vault account {s.chain.ledger.slice(0, 6)}…
                {s.chain.ledger.slice(-6)}
              </summary>
              <code>{s.chain.ledger}</code>
            </details>
            <a
              className="od-external"
              href={`/api/chain/tx/${s.chain.signature}`}
              target="_blank"
              rel="noreferrer"
            >
              View latest transaction proof
            </a>
          </div>
        </Panel>
      )}
      <Panel>
        <div className="od-panel-heading">
          <h2>Activity ledger</h2>
          <Button variant="secondary" onClick={download}>
            <Download size={16} />
            Export ledger
          </Button>
        </div>
        <div className="od-panel-heading od-ledger-controls">
          <div className="od-search">
            <Search size={16} />
            <input
              aria-label="Search activity"
              placeholder="Search transactions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Badge tone="neutral">Revision {s.revision}</Badge>
        </div>
        {rows.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Market session</th>
                  <th>Cash movement</th>
                  <th>Shares</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <b>{e.title}</b>
                      <small>{e.detail}</small>
                    </td>
                    <td>{e.date}</td>
                    <td className={e.cash > 0 ? 'od-positive' : ''}>
                      {e.cash > 0 ? '+' : ''}
                      {usd(
                        e.cash,
                        Math.abs(e.cash) < 0.01 && e.cash !== 0 ? 6 : 2,
                      )}
                    </td>
                    <td>
                      {e.shares > 0 ? '+' : ''}
                      {qty(e.shares)}
                    </td>
                    <td className="od-mono">{e.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              search
                ? 'No matching activity.'
                : 'A clean ledger. A fresh start.'
            }
            description={
              search
                ? 'Try a different transaction name or date.'
                : 'Deposit assets to create your first verified vault movement.'
            }
          />
        )}
      </Panel>
    </>
  );
}
