'use client';
import { usd } from './shared';

/**
 * Risk against reward, as two bars.
 *
 * The ticket used to answer "what am I getting into" with a four-row
 * summary of premium, collateral, settlement and margin mode — four
 * true facts that between them do not say what happens if the trade
 * goes wrong. This does, in the two numbers a reader actually wants,
 * at the size those numbers deserve.
 *
 * The bars are scaled against whichever side is larger, so a 1:4 risk
 * to reward looks like 1:4. An uncapped payoff fills its bar and says
 * so rather than quoting a number from the edge of the sampled window,
 * which is an artefact of where the sampling stopped.
 */
export function Scoreboard({
  risk,
  reward,
  capped,
  breakEven,
  premium,
  decimals = 2,
  invalid = false,
}: {
  /** Worst case, as a positive number. */
  risk: number;
  reward: number;
  capped: boolean;
  breakEven: number[];
  premium: number;
  decimals?: number;
  invalid?: boolean;
}) {
  const scale = Math.max(risk, capped ? reward : risk * 2, 1e-9);
  const riskShare = Math.min(1, risk / scale);
  const rewardShare = capped ? Math.min(1, reward / scale) : 1;
  const ratio = risk > 0 && capped && reward > 0 ? reward / risk : null;

  return (
    <div className="od-score" aria-live="polite">
      <div className="od-score-row">
        <div className="od-score-cell">
          <span>You risk</span>
          <strong className="down">
            {invalid ? '—' : risk > 0 ? usd(risk, decimals) : 'Nothing'}
          </strong>
        </div>
        <div className="od-score-cell right">
          <span>You can win</span>
          <strong className="up">
            {invalid ? '—' : capped ? usd(reward, decimals) : 'No ceiling'}
          </strong>
        </div>
      </div>

      <div className="od-score-bars">
        <i
          className="down"
          style={{ width: `${(invalid ? 0 : riskShare) * 100}%` }}
        />
        <i
          className={`up ${capped ? '' : 'open'}`}
          style={{ width: `${(invalid ? 0 : rewardShare) * 100}%` }}
        />
      </div>

      <div className="od-score-foot">
        <span>
          {premium >= 0 ? 'Premium paid' : 'Premium received'}{' '}
          <b>{invalid ? '—' : usd(Math.abs(premium), decimals)}</b>
        </span>
        <span>
          {breakEven.length
            ? `Break-even ${breakEven.map((b) => usd(b, decimals)).join(' and ')}`
            : invalid
              ? ''
              : risk > 0
                ? 'No break-even in range'
                : 'Profitable at any price'}
        </span>
        {ratio && ratio > 0 && (
          <span className="od-score-ratio">{ratio.toFixed(1)}× risked</span>
        )}
      </div>
    </div>
  );
}
