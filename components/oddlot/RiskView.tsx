'use client';
import Link from 'next/link';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import {
  Badge,
  Button,
  Empty,
  Heading,
  Panel,
  Stat,
  dateLabel,
  qty,
  usd,
} from './shared';
export function RiskView({ desk }: { desk: VaultController }) {
  const { state: s, busy, act } = desk;
  if (!s) return null;
  const r = s.risk;
  return (
    <>
      <Heading
        eyebrow="EVERY OBLIGATION ACCOUNTED FOR"
        title="See what your collateral covers."
        description="Margin follows enforceable settlement obligations. A shared vault does not mean shared assumptions."
      />
      <div className="od-three-grid od-metrics">
        <Panel>
          <Stat
            label="Collateral committed"
            value={usd(r.collateralValue)}
            detail={`${usd(r.cash)} + ${qty(r.shares)} NVDA`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Released by valid offsets"
            value={usd(r.releasedValue)}
            detail="Compared with standalone position reserves"
            tone="positive"
          />
        </Panel>
        <Panel>
          <Stat
            label="Free to withdraw or deploy"
            value={usd(r.availableValue)}
            detail="Lent shares and reserved assets excluded"
          />
        </Panel>
      </div>
      <Panel>
        <div className="od-panel-heading">
          <div>
            <h2>Vault collateral policy</h2>
            <p>
              Switching modes recalculates every reserve. An underfunded switch
              is rejected.
            </p>
          </div>
          <Badge tone="green">Enforced by backend</Badge>
        </div>
        <div className="od-policy-grid">
          {(
            [
              {
                id: 'cross',
                title: 'Cross collateral',
                description:
                  'Net obligations only within the same reference, expiry, and settlement type. Joint expiry settlement preserves those offsets.',
              },
              {
                id: 'isolated',
                title: 'Isolated collateral',
                description:
                  'Reserve each contract independently. Capital offsets across separate positions do not release collateral.',
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              className={`od-policy ${s.book.margin === m.id ? 'selected' : ''}`}
              disabled={busy}
              onClick={() => void act({ type: 'margin', mode: m.id })}
            >
              <span className="od-radio" />
              <div>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
              </div>
              {s.book.margin === m.id && <Badge>Active</Badge>}
            </button>
          ))}
        </div>
      </Panel>
      <Panel>
        <div className="od-panel-heading">
          <div>
            <h2>Settlement groups</h2>
            <p>
              Worst-case cash and share deliveries are checked at every strike
              boundary and price tail.
            </p>
          </div>
        </div>
        {r.groups.length ? (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Expiry group</th>
                  <th>Contracts</th>
                  <th>Settlement</th>
                  <th>Your cash reserved</th>
                  <th>Your shares reserved</th>
                  <th>Counterparty backing</th>
                </tr>
              </thead>
              <tbody>
                {r.groups.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <b>{dateLabel(g.expiry)}</b>
                    </td>
                    <td>{g.positions}</td>
                    <td>{g.settlement}</td>
                    <td>{usd(g.cash)}</td>
                    <td>{qty(g.shares)} NVDA</td>
                    <td>
                      {usd(g.counterpartyCash)} + {qty(g.counterpartyShares)}{' '}
                      shares
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No option obligations yet."
            description="Each funded contract creates a visible reserve here. Protected-short reserves are added separately."
          />
        )}
      </Panel>
      <div className="od-two-grid">
        <Panel className="od-explainer">
          <span className="od-eyebrow">NO DOUBLE COUNTING</span>
          <h3>A share has one job at a time.</h3>
          <p>
            Covered calls reserve shares. A stock loan removes those shares from
            your spendable vault. Withdrawals and stock sales must leave all
            remaining commitments fully funded.
          </p>
          <div>
            <span>Standalone cash requirement</span>
            <b>{usd(r.grossCash)}</b>
          </div>
          <div>
            <span>Standalone share requirement</span>
            <b>{qty(r.grossShares)} NVDA</b>
          </div>
          <div>
            <span>Applied cash requirement</span>
            <b>{usd(r.cash)}</b>
          </div>
          <div>
            <span>Applied share requirement</span>
            <b>{qty(r.shares)} NVDA</b>
          </div>
        </Panel>
        <Panel className="od-explainer">
          <span className="od-eyebrow">EXPLICIT BOUNDARIES</span>
          <h3>Offsets must survive settlement.</h3>
          <p>
            No offsets between different expiries, dividend and stock
            references, cash and physical contracts, or external lenders. This
            is a fully reserved delivery engine, not broker portfolio margin or
            correlation-based leverage.
          </p>
          <p>
            Stock shorts use covered protective calls, not a liquidation
            assumption. Loans pre-fund test interest. Prices and options
            premiums remain clearly identified as historical observations and
            model values.
          </p>
          <Link className="od-external" href="/legacy">
            Open the retained Solana escrow desk ↗
          </Link>
        </Panel>
      </div>
      <Panel className="od-audit-strip">
        <div>
          <Badge tone="green">Transactional</Badge>
          <h3>Every mutation has a receipt.</h3>
          <p>
            Session ownership, revision checks, idempotency keys, and
            conservation checks protect the ledger.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void desk.refresh()}>
          Reconcile vault
        </Button>
      </Panel>
    </>
  );
}
