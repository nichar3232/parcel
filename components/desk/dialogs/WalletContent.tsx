'use client';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { money } from '@/lib/engine';
import { Download, Wallet } from 'lucide-react';
export function WalletContent({
  book,
  setModal,
  wallet,
  download,
  connect,
  reset,
}: Pick<
  Desk,
  'book' | 'setModal' | 'wallet' | 'download' | 'connect' | 'reset'
>) {
  return (
    <>
      <div className="wallet-summary">
        <Wallet size={30} />
        <strong>{money(book.holderCash)}</strong>
        <span>Available demo USDC</span>
      </div>
      <p>
        Your practice balances are saved by the backend in a private browser
        session. No wallet installation or real funds are needed. On-chain
        actions use separate, session-specific test wallets.
      </p>
      <Button className="primary full" onClick={connect}>
        {wallet ? 'Reconnect Solana wallet' : 'Connect Solana wallet'}
        <Wallet size={14} />
      </Button>
      {wallet && <code>{wallet}</code>}
      <Button variant="outline" onClick={download}>
        <Download size={14} />
        Export practice session
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          void reset();
          setModal(null);
        }}
      >
        Reset practice balances
      </Button>
    </>
  );
}
