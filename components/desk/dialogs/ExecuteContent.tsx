'use client';
import { Metric, Status, day, short } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { maximum, money } from '@/lib/engine';
import { priceOn } from '@/lib/scenarios';
import { shownWarning } from '@/lib/client/chain-copy';
import { CheckCheck, ExternalLink, Link as LinkIcon, Lock } from 'lucide-react';
export function ExecuteContent({
  health,
  chainReady,
  terms,
  remote,
  valid,
  missing,
  setMissing,
  evidence,
  remoteBusy,
  chainAction,
  setRemote,
}: Pick<
  Desk,
  | 'health'
  | 'chainReady'
  | 'terms'
  | 'remote'
  | 'valid'
  | 'missing'
  | 'setMissing'
  | 'evidence'
  | 'remoteBusy'
  | 'chainAction'
  | 'setRemote'
>) {
  return (
    <>
      <div className="chain-banner">
        <LinkIcon size={22} />
        <div>
          <strong>
            {remote?.network === 'devnet'
              ? 'Solana devnet'
              : evidence?.network === 'devnet'
                ? 'Solana devnet'
                : 'Solana local validator'}
          </strong>
          <p>
            Real transactions · session-specific test wallets · historical
            replay oracle
          </p>
        </div>
      </div>
      <p className="field-note">
        This flow moves test tokens through the compiled Solana program. It is
        separate from your practice portfolio. Historical expiry is compressed
        to 90 seconds after funding.
      </p>
      {shownWarning(remote?.warning) && (
        <output className="form-error">{remote?.warning}</output>
      )}
      {!remote ? (
        <>
          <div className="contract-metrics">
            <Metric
              label="Maker reserve"
              value={valid ? '—' : money(maximum(terms))}
            />
            <Metric label="Holder premium" value={money(terms.premium)} />
          </div>
          <div className="detail-row">
            <span>Structure</span>
            <strong>
              {terms.quantity} NVDA {terms.kind} · {money(terms.low, 0)} /{' '}
              {money(terms.high, 0)}
            </strong>
          </div>
          <div className="detail-row">
            <span>Precommitted reference</span>
            <strong>
              {day(terms.expiry)} · {money(priceOn(terms.expiry))}
            </strong>
          </div>
          <Button
            className="primary full"
            disabled={
              remoteBusy || !!valid || !health?.chain.ready || !chainReady
            }
            onClick={() => chainAction('fund')}
          >
            {remoteBusy ? (
              <>
                <span className="spinner" />
                Funding escrow…
              </>
            ) : (
              <>
                Maker: fund this offer <Lock size={14} />
              </>
            )}
          </Button>
        </>
      ) : (
        <>
          <div className="flex-between">
            <h2>
              {remote.terms.quantity} NVDA {remote.terms.kind} spread
            </h2>
            <Status status={remote.status} />
          </div>
          <div className="detail-row">
            <span>Live escrow balance</span>
            <strong>{money(remote.escrow)} test USDC</strong>
          </div>
          <div className="detail-row">
            <span>Holder / maker wallets</span>
            <code>
              {short(remote.holder)} / {short(remote.maker)}
            </code>
          </div>
          <div className="detail-row">
            <span>Offer account</span>
            <code>{short(remote.offer)}</code>
          </div>
          <div className="detail-row">
            <span>Precommitted settlement</span>
            <strong>
              {money(remote.price)} · {day(remote.terms.expiry)}
            </strong>
          </div>
          <div className="detail-row">
            <span>Replay observation available</span>
            <strong>
              {remote.chainTime === undefined
                ? 'Checking chain clock…'
                : `${Math.max(0, remote.expiry - remote.chainTime)} chain seconds`}
            </strong>
          </div>
          <div className="modal-actions">
            {remote.status === 'funded' && (
              <>
                <Button
                  variant="outline"
                  disabled={remoteBusy}
                  onClick={() => chainAction('cancel')}
                >
                  Maker: cancel & reclaim
                </Button>
                <Button
                  className="primary"
                  disabled={
                    remoteBusy ||
                    remote.chainTime === undefined ||
                    remote.chainTime >= remote.deadline
                  }
                  onClick={() => chainAction('accept')}
                >
                  Holder: accept · {money(remote.terms.premium)}
                </Button>
              </>
            )}
            {['active', 'awaiting'].includes(remote.status) && (
              <Button
                className="primary"
                disabled={
                  remoteBusy ||
                  remote.chainTime === undefined ||
                  remote.chainTime < remote.expiry
                }
                onClick={() => chainAction('settle')}
              >
                {remote.status === 'awaiting'
                  ? 'Retry committed observation'
                  : 'Settle on Solana'}
              </Button>
            )}
            {remote.status === 'settled' && (
              <>
                <Button
                  className="primary"
                  disabled={remoteBusy || remote.buyerClaimed}
                  onClick={() => chainAction('claim-holder')}
                >
                  {remote.buyerClaimed
                    ? 'Holder claimed'
                    : `Holder: claim ${money(remote.buyerPayout)}`}
                </Button>
                <Button
                  variant="outline"
                  disabled={remoteBusy || remote.makerClaimed}
                  onClick={() => chainAction('claim-maker')}
                >
                  {remote.makerClaimed
                    ? 'Maker claimed'
                    : 'Maker: claim remainder'}
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={remoteBusy}
              onClick={() => chainAction('read')}
            >
              {remoteBusy ? 'Confirming…' : 'Refresh chain state'}
            </Button>
          </div>
          {['active', 'awaiting'].includes(remote.status) && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={missing}
                onChange={(e) => setMissing(e.target.checked)}
              />
              Simulate missing observation; collateral stays locked
            </label>
          )}
          <div className="chain-events">
            {remote.transactions.map((t, i) => (
              <div key={i}>
                <CheckCheck size={14} />
                <span>{t.label}</span>
                <a
                  href={
                    remote.network === 'devnet'
                      ? `https://explorer.solana.com/tx/${t.signature}?cluster=devnet`
                      : `/api/chain/tx/${t.signature}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(t.signature)}
                  <ExternalLink size={12} />
                </a>
              </div>
            ))}
          </div>
          <div className="field-note">
            Read from slot {remote.lastSlot}. Program: {short(remote.programId)}
            . Mint: {short(remote.mint)}. Test USDC is not Circle USDC.
          </div>
          {['closed', 'cancelled'].includes(remote.status) && (
            <Button variant="outline" onClick={() => setRemote(null)}>
              Build another chain contract
            </Button>
          )}
        </>
      )}
    </>
  );
}
