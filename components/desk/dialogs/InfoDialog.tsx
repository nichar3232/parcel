'use client';
import { AboutContent } from '@/components/desk/dialogs/AboutContent';
import { ChainContent } from '@/components/desk/dialogs/ChainContent';
import { ExecuteContent } from '@/components/desk/dialogs/ExecuteContent';
import { GuideContent } from '@/components/desk/dialogs/GuideContent';
import { RiskContent } from '@/components/desk/dialogs/RiskContent';
import { WalletContent } from '@/components/desk/dialogs/WalletContent';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Desk } from '@/hooks/desk/use-desk';
export function InfoDialog(desk: Desk) {
  const { modal, setModal } = desk;
  return (
    <Dialog open={!!modal} onOpenChange={(open) => !open && setModal(null)}>
      <DialogContent
        className={
          modal === 'chain' || modal === 'execute' ? 'wide-modal' : 'info-modal'
        }
      >
        <DialogTitle>
          {modal === 'wallet'
            ? 'Your demo wallet'
            : modal === 'guide'
              ? 'Your first protected position'
              : modal === 'chain'
                ? 'Proof, on Solana'
                : modal === 'execute'
                  ? 'Your contract, on Solana'
                  : modal === 'risk'
                    ? 'Where your capital lives'
                    : 'Meet Strata'}
        </DialogTitle>
        <DialogDescription>
          {modal === 'chain' || modal === 'execute'
            ? 'Program-enforced test-token escrow — no real-value assets.'
            : 'An equity desk built around clear terms and visible collateral.'}
        </DialogDescription>
        {modal === 'execute' && <ExecuteContent {...desk} />}
        {modal === 'wallet' && <WalletContent {...desk} />}
        {modal === 'guide' && <GuideContent {...desk} />}
        {modal === 'risk' && <RiskContent {...desk} />}
        {modal === 'about' && <AboutContent />}
        {modal === 'chain' && <ChainContent {...desk} />}
      </DialogContent>
    </Dialog>
  );
}
