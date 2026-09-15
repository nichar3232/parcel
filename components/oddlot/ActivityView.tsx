'use client';
import { useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import { Badge, Button, Empty, Heading, Panel, qty, usd } from './shared';
export function ActivityView({ desk }: { desk: VaultController }) {
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
            { revision: s.revision, mode: s.mode, book: s.book, risk: s.risk },
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
      <Heading
        eyebrow="THE RECORD BEHIND YOUR BALANCES"
        title="Every movement, accounted for."
        description="Deposits, trades, commitments, and settlement in one persistent activity ledger."
        action={
          <Button variant="secondary" onClick={download}>
            <Download size={16} />
            Export ledger
          </Button>
        }
      />
      <Panel>
        <div className="od-panel-heading">
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
