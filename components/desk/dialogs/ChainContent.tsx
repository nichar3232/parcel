'use client';
import { short } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Link as LinkIcon,
} from 'lucide-react';
export function ChainContent({
  evidence,
  chainBusy,
  runChain,
}: Pick<Desk, 'evidence' | 'chainBusy' | 'runChain'>) {
  return (
    <>
      <div className="chain-banner">
        <LinkIcon size={22} />
        <div>
          <strong>
            {evidence?.network === 'devnet'
              ? 'Real devnet transactions'
              : evidence?.network === 'localnet'
                ? 'Real Solana local-validator transactions'
                : 'Solana verification'}
          </strong>
          <p>
            Two test wallets · SPL settlement token · immutable replay sample
          </p>
        </div>
        <span className="pill">{evidence?.network || 'Unavailable'}</span>
      </div>
      {evidence ? (
        <>
          <div className="detail-row">
            <span>Program</span>
            <a
              className="text-link mono"
              href={
                evidence.network === 'devnet'
                  ? `https://explorer.solana.com/address/${evidence.programId}?cluster=devnet`
                  : '/api/evidence'
              }
              target="_blank"
              rel="noreferrer"
            >
              {short(evidence.programId || '')}
              <ExternalLink size={12} />
            </a>
          </div>
          <div className="detail-row">
            <span>Test USDC mint</span>
            <code>{short(evidence.mint || '')}</code>
          </div>
          <div className="detail-row">
            <span>Holder / maker</span>
            <code>
              {short(evidence.holder || '')} / {short(evidence.maker || '')}
            </code>
          </div>
          <p className="field-note">
            Team-controlled test wallets. The mint is test USDC, not Circle
            USDC. The oracle replays a historical daily close committed before
            the offer is funded. It is not a live Pyth feed.
          </p>
          <div className="chain-events">
            {(evidence.transactions || []).map((t, i) => (
              <div key={i}>
                <CheckCheck size={15} />
                <span>{t.label}</span>
                {evidence.network === 'devnet' ? (
                  <a
                    href={`https://explorer.solana.com/tx/${t.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(t.signature)}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <a
                    href={`/api/chain/tx/${t.signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(t.signature)}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
          {evidence.checks && (
            <div className="check-results">
              {evidence.checks.map((c, i) => (
                <span key={i}>
                  <Check size={12} />
                  {c}
                </span>
              ))}
            </div>
          )}
          <div className="detail-row">
            <span>Last verification</span>
            <strong>{new Date(evidence.completedAt).toLocaleString()}</strong>
          </div>
        </>
      ) : (
        <div className="empty">
          <Clock size={25} />
          <p>
            Chain evidence is not available from this server yet. The practice
            simulation remains usable.
          </p>
        </div>
      )}
      <Button className="primary full" disabled={chainBusy} onClick={runChain}>
        {chainBusy ? (
          <>
            <span className="spinner" />
            Refreshing evidence…
          </>
        ) : (
          <>
            Refresh verified evidence <ArrowUpRight size={14} />
          </>
        )}
      </Button>
      <p className="field-note">
        Read the latest recorded contract tests. Use “Try this contract on
        Solana” in Build to execute your own test-token lifecycle.
      </p>
    </>
  );
}
