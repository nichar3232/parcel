'use client';
import { useState } from 'react';
import type { VaultController } from '@/hooks/oddlot/use-vault';
import type { Asset } from '@/lib/oddlot/types';
import { AssetLogo, ASSETS } from './AssetLogo';
import { Button, Field, Modal, Line, qty, usd } from './shared';

export type Transfer = { asset: Asset; direction: 'deposit' | 'withdraw' };

/**
 * Deposits and withdrawals, lifted out of the portfolio screen.
 *
 * Funding used to live inside one panel on one view, so the answer to
 * "I want to put money in" depended on which screen you happened to be
 * looking at. It is in the app bar now, which means the dialog has to
 * be owned by the shell and cannot assume a vault view is mounted.
 */
export function TransferDialog({
  desk,
  transfer,
  onClose,
}: {
  desk: VaultController;
  transfer: Transfer;
  onClose: () => void;
}) {
  const s = desk.state!;
  const { asset, direction } = transfer;
  const [amount, setAmount] = useState(asset === 'NVDA' ? '1' : '1000');

  const free =
    direction === 'deposit'
      ? s.book.wallet[asset]
      : asset === 'USDC'
        ? s.risk.freeCash
        : s.risk.freeShares;
  const value = Number(amount);
  const over = Number.isFinite(value) && value > free;

  const submit = async () => {
    if (await desk.act({ type: 'transfer', asset, direction, amount: value }))
      onClose();
  };

  return (
    <Modal
      onClose={onClose}
      title={`${direction === 'deposit' ? 'Deposit' : 'Withdraw'} ${asset}`}
      description={
        direction === 'deposit'
          ? 'Move assets from your wallet into the collateral vault.'
          : 'Only unencumbered assets can return to your wallet.'
      }
    >
      <div className="od-transfer-asset">
        <AssetLogo symbol={asset} size={40} />
        <div>
          <b>{ASSETS[asset].name}</b>
          <small>
            {asset} {ASSETS[asset].note.toLowerCase()}
          </small>
        </div>
      </div>

      <Field
        label="Amount"
        hint={`${direction === 'deposit' ? 'Wallet' : 'Available'} ${qty(free)} ${asset}`}
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

      {/* Four steps to the balance rather than a max button alone: a
          quarter of a share is the size this product exists for. */}
      <div className="od-quick">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button
            key={f}
            onClick={() =>
              setAmount(String(Math.round(free * f * 1e6) / 1e6 || 0))
            }
          >
            {f === 1 ? 'Max' : `${f * 100}%`}
          </button>
        ))}
      </div>

      <div className="od-lines">
        <Line
          label={direction === 'deposit' ? 'Vault after' : 'Wallet after'}
          value={`${qty(
            Math.max(
              0,
              (direction === 'deposit' ? s.book.vault[asset] : s.book.wallet[asset]) +
                (Number.isFinite(value) ? value : 0),
            ),
          )} ${asset}`}
        />
        {asset === 'NVDA' && Number.isFinite(value) && (
          <Line
            label="At the stored reference close"
            value={usd(value * s.market.price)}
            tone="muted"
          />
        )}
      </div>

      {/* A warning, not a gate. What counts as available depends on
          collateral rules the backend owns, so it stays the authority on
          whether a withdrawal is allowed — the client says what it
          expects and lets the answer come back from the ledger. */}
      {over && (
        <p className="od-error" role="alert">
          That is more than the {qty(free)} {asset} this desk shows as
          available. The vault will check it again.
        </p>
      )}

      <Button
        size="lg"
        full
        disabled={desk.busy || !Number.isFinite(value) || value <= 0}
        onClick={() => void submit()}
      >
        {desk.busy ? 'Confirming…' : `Confirm ${direction}`}
      </Button>
    </Modal>
  );
}
