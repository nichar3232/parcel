'use client';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, ShieldCheck } from 'lucide-react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { Asset } from '@/lib/oddlot/types';
import { ActivityLedger } from './ActivityLedger';
import {
  AssetIcon,
  Badge,
  Button,
  Field,
  Heading,
  LinkButton,
  Modal,
  Panel,
  qty,
  usd,
} from './shared';
export function VaultView({
  desk,
  navigate,
}: {
  desk: VaultController;
  navigate: (page: string) => void;
}) {
  const { state, busy, act } = desk;
  const [transfer, setTransfer] = useState<{
      asset: Asset;
      direction: 'deposit' | 'withdraw';
    } | null>(null),
    [amount, setAmount] = useState('1');
  if (!state) return null;
  const { book, risk, market } = state,
    nav = book.vault.USDC + book.vault.NVDA * market.price;
  const lent = book.loans
    .filter((p) => p.status === 'active')
    .reduce((s, p) => s + p.quantity, 0);
  const open = (asset: Asset, direction: 'deposit' | 'withdraw') => {
    setAmount(asset === 'NVDA' ? '1' : '1000');
    setTransfer({ asset, direction });
  };
  const submit = async () => {
    if (
      transfer &&
      (await act({ type: 'transfer', ...transfer, amount: Number(amount) }))
    )
      setTransfer(null);
  };
  return (
    <>
      <Heading
        eyebrow="YOUR CAPITAL, YOUR TERMS"
        title="A little stock. A lot of possibility."
        description="One vault for your shares, options, and collateral. Put precisely what you own to work."
        action={
          <Button onClick={() => open('NVDA', 'deposit')}>
            <Plus size={16} />
            Deposit assets
          </Button>
        }
      />
      <div className="od-vault-grid">
        <section className="od-capital-card">
          <div className="od-card-top">
            <span>Vault balance</span>
            <ShieldCheck size={19} />
          </div>
          <strong>{usd(nav)}</strong>
          <p>USDC + NVDA at the stored reference close</p>
          <div className="od-capital-bottom">
            <div>
              <small>Available to deploy</small>
              <b>{usd(risk.availableValue)}</b>
            </div>
            <div>
              <small>Committed collateral</small>
              <b>{usd(risk.collateralValue)}</b>
            </div>
          </div>
          <div className="od-progress">
            <i style={{ width: `${Math.min(100, risk.utilization * 100)}%` }} />
          </div>
          <small>
            {(risk.utilization * 100).toFixed(1)}% of vault capital committed
          </small>
        </section>
        <Panel className="od-allocation">
          <div className="od-panel-heading">
            <h2>Capital allocation</h2>
            <Badge tone="green">Verified</Badge>
          </div>
          <div className="od-allocation-body">
            <div
              className="od-donut"
              style={{
                background: `conic-gradient(#456be8 0 ${risk.utilization * 100}%,#e9edf5 ${risk.utilization * 100}% 100%)`,
              }}
            >
              <div>
                <strong>
                  {book.options.filter((p) => p.status === 'active').length}
                </strong>
                <small>active contracts</small>
              </div>
            </div>
            <div className="od-legend">
              <div>
                <i />
                <span>Available</span>
                <b>{usd(risk.availableValue)}</b>
              </div>
              <div>
                <i />
                <span>Reserved</span>
                <b>{usd(risk.collateralValue)}</b>
              </div>
              <div>
                <i />
                <span>Out on loan</span>
                <b>{qty(lent)} shares</b>
              </div>
            </div>
          </div>
          <div className="od-panel-foot">
            <span>Collateral mode</span>
            <LinkButton onClick={() => navigate('Risk')}>
              {book.margin === 'cross'
                ? 'Cross collateral'
                : 'Isolated collateral'}
            </LinkButton>
          </div>
        </Panel>
      </div>
      <Panel>
        <div className="od-panel-heading">
          <div>
            <h2>Your assets</h2>
            <p>
              Spendable balances are separate from assets pledged to a contract.
            </p>
          </div>
          <span className="od-muted">2 supported assets</span>
        </div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>In vault</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Wallet</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(['NVDA', 'USDC'] as const).map((asset) => (
                <tr key={asset}>
                  <td>
                    <div className="od-asset-cell">
                      <AssetIcon cash={asset === 'USDC'} />
                      <div>
                        <b>{asset === 'NVDA' ? 'NVIDIA' : 'USD Coin'}</b>
                        <small>
                          {asset === 'NVDA'
                            ? 'NVDA · share-equivalents'
                            : 'USDC · settlement asset'}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{qty(book.vault[asset])}</td>
                  <td>{qty(asset === 'NVDA' ? risk.shares : risk.cash)}</td>
                  <td>
                    <b>
                      {qty(asset === 'NVDA' ? risk.freeShares : risk.freeCash)}
                    </b>
                  </td>
                  <td className="od-muted">{qty(book.wallet[asset])}</td>
                  <td>
                    <div className="od-row-actions">
                      <button
                        onClick={() => open(asset, 'deposit')}
                        aria-label={`Deposit ${asset}`}
                      >
                        <ArrowDownLeft size={15} />
                        Deposit
                      </button>
                      <button
                        onClick={() => open(asset, 'withdraw')}
                        aria-label={`Withdraw ${asset}`}
                      >
                        <ArrowUpRight size={15} />
                        Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="od-section-heading">
        <h2>Make your next move</h2>
      </div>
      <div className="od-three-grid">
        {[
          {
            title: 'Underwrite with what you own',
            detail:
              'Deposit a share. Write a covered call. See exactly what stays locked.',
            tag: 'COVERED INCOME',
            page: 'Underwrite',
            number: '01',
          },
          {
            title: 'Build around your view',
            detail:
              'Buy protection or construct a spread at the size that fits your portfolio.',
            tag: 'OPTIONS BY THE SHARE',
            page: 'Trade',
            number: '02',
          },
          {
            title: 'Give idle shares a purpose',
            detail:
              'Lend available stock against a funded, inspectable collateral balance.',
            tag: 'COLLATERALIZED LENDING',
            page: 'Lending',
            number: '03',
          },
        ].map((c) => (
          <button
            key={c.page}
            className="od-action-card"
            onClick={() => navigate(c.page)}
          >
            <span>
              {c.tag}
              <b>{c.number}</b>
            </span>
            <h3>{c.title}</h3>
            <p>{c.detail}</p>
            <ArrowUpRight size={19} />
          </button>
        ))}
      </div>
      <ActivityLedger desk={desk} />
      {transfer && (
        <Modal
          onClose={() => setTransfer(null)}
          title={`${transfer.direction === 'deposit' ? 'Deposit' : 'Withdraw'} ${transfer.asset}`}
          description={
            transfer.direction === 'deposit'
              ? 'Move assets from your wallet into the collateral vault.'
              : 'Only unencumbered assets can return to your wallet.'
          }
        >
          <Field
            label="Amount"
            help={`Available: ${qty(transfer.direction === 'deposit' ? book.wallet[transfer.asset] : transfer.asset === 'USDC' ? risk.freeCash : risk.freeShares)} ${transfer.asset}`}
          >
            <input
              inputMode="decimal"
              type="number"
              min="0.000001"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Button
            disabled={
              busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0
            }
            onClick={() => void submit()}
          >
            {busy ? 'Confirming…' : `Confirm ${transfer.direction}`}
          </Button>
        </Modal>
      )}
    </>
  );
}
