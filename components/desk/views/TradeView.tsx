'use client';
import { PayoffChart } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import { money } from '@/lib/engine';
import { ArrowRight, Info, Shield, TrendingUp } from 'lucide-react';
export function TradeView({
  current,
  terms,
  entry,
  setTerms,
  navigate,
}: Pick<Desk, 'current' | 'terms' | 'entry' | 'setTerms' | 'navigate'>) {
  return (
    <>
      <div className="market-strip">
        <div className="asset-cell">
          <div className="asset-icon">N</div>
          <div>
            <strong>NVIDIA</strong>
            <p>One reference. Two defined-risk structures.</p>
          </div>
        </div>
        <strong>{money(current.close)}</strong>
        <span className="pill">Historical reference</span>
      </div>
      <div className="strategy-grid">
        {[
          {
            kind: 'put',
            title: 'Protect the downside',
            text: 'Keep your stock exposure and offset losses inside a price range.',
            icon: Shield,
            low: 120,
            high: 140,
            premium: 400,
          },
          {
            kind: 'call',
            title: 'Capture capped upside',
            text: 'Express a bullish view with a fixed upfront cost and limited payout.',
            icon: TrendingUp,
            low: 140,
            high: 160,
            premium: 500,
          },
        ].map((s) => (
          <section className="panel strategy-card" key={s.kind}>
            <s.icon size={28} />
            <span className="eyebrow">{s.kind.toUpperCase()} SPREAD</span>
            <h2>{s.title}</h2>
            <p>{s.text}</p>
            <PayoffChart
              terms={{
                ...terms,
                kind: s.kind as 'put' | 'call',
                low: s.low,
                high: s.high,
                premium: s.premium,
              }}
              entry={entry}
            />
            <div className="strategy-meta">
              <span>Fully funded payout</span>
              <span>USDC settlement</span>
            </div>
            <Button
              className="primary"
              onClick={() => {
                setTerms({
                  ...terms,
                  kind: s.kind as 'put' | 'call',
                  low: s.low,
                  high: s.high,
                  premium: s.premium,
                });
                navigate('Build');
              }}
            >
              Customize strategy <ArrowRight size={15} />
            </Button>
          </section>
        ))}
      </div>
      <div className="info-strip">
        <Info size={16} />
        <p>
          These are synthetic cash-settled contracts referencing NVDA. They do
          not deliver stock or represent exchange-listed options. Premiums are
          manually quoted by the demo maker.
        </p>
      </div>
    </>
  );
}
