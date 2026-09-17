'use client';
import type { VaultController } from '@/hooks/parcel/use-vault';
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
export function RiskView({
  desk,
  embedded = false,
}: {
  desk: VaultController;
  embedded?: boolean;
}) {
  const { state: s, busy, act } = desk;
  if (!s) return null;
  const r = s.risk;
  return (
    <>
      {embedded ? (
        <div className="od-section-break">
          <h2>What your collateral covers</h2>
          <p>
            Margin follows enforceable settlement obligations. A shared vault
            does not mean shared assumptions.
          </p>
        </div>
      ) : (
        <Heading
          eyebrow="EVERY OBLIGATION ACCOUNTED FOR"
          title="See what your collateral covers."
          description="Margin follows enforceable settlement obligations. A shared vault does not mean shared assumptions."
        />
      )}
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
                  'Net matching settlement obligations. Earlier guaranteed cash receipts can fund later obligations, with every intermediate cash deficit reserved.',
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
              Worst-case delivery is checked at every strike boundary and price
              tail, before calendar offsets.
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
                  <th>Standalone group cash</th>
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
                    <td>
                      {usd(g.cash)}
                      {g.cashMinimum > 0 && (
                        <small>
                          Guaranteed receipt {usd(g.cashMinimum, 6)}
                        </small>
                      )}
                    </td>
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
      <Panel>
        <div className="od-panel-heading">
          <h2>Collateral requirements</h2>
          <Badge tone="neutral">
            {r.releasedValue > 0 ? 'Offsets applied' : 'No offsets'}
          </Badge>
        </div>
        <div className="od-panel-body">
          <div className="od-review-lines">
            <div className="od-review-line">
              <span>Standalone cash requirement</span>
              <b>{usd(r.grossCash)}</b>
            </div>
            <div className="od-review-line">
              <span>Standalone share requirement</span>
              <b>{qty(r.grossShares)} NVDA</b>
            </div>
            <div className="od-review-line">
              <span>Applied cash requirement</span>
              <b>{usd(r.cash)}</b>
            </div>
            <div className="od-review-line">
              <span>Applied share requirement</span>
              <b>{qty(r.shares)} NVDA</b>
            </div>
          </div>
          <p className="od-form-note">
            A share has one job at a time. Withdrawals and sales must leave
            every remaining commitment fully funded.
          </p>
        </div>
      </Panel>
      <Panel className="od-audit-strip">
        <div>
          <h3>Vault integrity</h3>
          <p>
            Re-read every balance and reserve from the ledger and compare it
            with what this screen shows.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void desk.refresh()}>
          Reconcile vault
        </Button>
      </Panel>
    </>
  );
}
