'use client';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { money } from '@/lib/engine';
import { ArrowRight } from 'lucide-react';
export function RiskContent({
  navigate,
  book,
  setModal,
  claims,
  totalLocked,
  setFinanceTab,
}: Pick<
  Desk,
  'navigate' | 'book' | 'setModal' | 'claims' | 'totalLocked' | 'setFinanceTab'
>) {
  return (
    <>
      <div className="detail-row">
        <span>Holder cash available</span>
        <strong>{money(book.holderCash)}</strong>
      </div>
      <div className="detail-row">
        <span>Unencumbered equity units</span>
        <strong>100 test shares</strong>
      </div>
      <div className="detail-row">
        <span>Maker reserve, separate escrow</span>
        <strong>{money(totalLocked)}</strong>
      </div>
      <div className="detail-row">
        <span>Holder fixed unpaid claims</span>
        <strong>{money(claims)}</strong>
      </div>
      <div className="detail-row">
        <span>External collateral / debt</span>
        <strong>None</strong>
      </div>
      <p>
        Maker collateral is not holder wealth. Unsettled derivatives are not
        assigned a market value, so the headline portfolio value excludes their
        unknown value. A protective spread does not pledge the underlying
        shares.
      </p>
      <Button
        className="primary"
        onClick={() => {
          setModal(null);
          navigate('Finance');
          setFinanceTab('allocation');
        }}
      >
        Explore capital map <ArrowRight size={14} />
      </Button>
    </>
  );
}
