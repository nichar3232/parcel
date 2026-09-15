'use client';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { ArrowLeft, ArrowRight, Play } from 'lucide-react';
export function GuideContent({
  navigate,
  setGuideStep,
  setModal,
  selectScenario,
  guideStep,
}: Pick<
  Desk,
  'navigate' | 'setGuideStep' | 'setModal' | 'selectScenario' | 'guideStep'
>) {
  return (
    <>
      <div className="guide-progress">
        {['Build', 'Fund', 'Replay', 'Claim'].map((s, i) => (
          <span className={guideStep === i ? 'selected' : ''} key={s}>
            {i + 1} {s}
          </span>
        ))}
      </div>
      <div className="guide-body">
        <div className="round-icon">{guideStep + 1}</div>
        <h2>
          {
            [
              'Start with a real market moment.',
              'Be the other side.',
              'Let the market play out.',
              'Bring the capital home.',
            ][guideStep]
          }
        </h2>
        <p>
          {
            [
              'Use the DeepSeek scenario: 100 NVDA shares, $120–$140 downside protection, and a $400 illustrative premium. Request a quote in Build.',
              'In Maker, choose the total premium and reserve $2,000. Review as holder and accept the funded offer. The quote lasts two minutes.',
              'Open the position, advance to expiry, and settle against the stored January 27 close. Try missing data first: the reserve stays locked until a retry succeeds.',
              'Claim the holder payout, then the maker remainder. Portfolio and Activity reconcile every unit. Open Solana proof to inspect the separate real-chain verification.',
            ][guideStep]
          }
        </p>
      </div>
      <div className="modal-actions">
        <Button
          variant="outline"
          disabled={guideStep === 0}
          onClick={() => setGuideStep(guideStep - 1)}
        >
          <ArrowLeft size={13} />
          Back
        </Button>
        {guideStep < 3 ? (
          <Button
            className="primary"
            onClick={() => setGuideStep(guideStep + 1)}
          >
            Next <ArrowRight size={13} />
          </Button>
        ) : (
          <Button
            className="primary"
            onClick={() => {
              selectScenario('deepseek');
              setModal(null);
              navigate('Build');
            }}
          >
            Start the demo <Play size={13} />
          </Button>
        )}
      </div>
    </>
  );
}
