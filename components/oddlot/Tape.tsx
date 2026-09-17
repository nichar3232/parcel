'use client';
import type { MarkFeed } from '@/hooks/oddlot/use-marks';
import { AssetLogo } from './AssetLogo';
import { Badge, Panel, PanelHead, qty, usd } from './shared';

/**
 * The maker's tape.
 *
 * Prints arrive two or three a second and each one mints or burns the
 * mock token standing in for its underlying, so the supply column and
 * the tape are two views of the same activity and can be checked
 * against each other. Capped at a dozen rows: a tape that fills the
 * page is a log, and nobody reads a log.
 *
 * `symbols` narrows it to one screen's instruments. The pre-IPO page
 * showing BTC prints would be noise.
 */
export function Tape({
  feed,
  title,
  description,
  symbols,
  limit = 12,
}: {
  feed: MarkFeed;
  title: string;
  description: string;
  symbols?: string[];
  limit?: number;
}) {
  const prints = feed.tape
    .filter((p) => !symbols || symbols.includes(p.symbol))
    .slice(0, limit);

  return (
    <Panel>
      <PanelHead
        title={title}
        description={description}
        action={
          <Badge tone={feed.connected ? 'green' : 'neutral'}>
            {qty(Math.round(feed.minted))} minted,{' '}
            {qty(Math.round(feed.burned))} burned
          </Badge>
        }
      />
      <div className="od-tape">
        {prints.length ? (
          prints.map((p) => (
            <div key={p.id} className={`od-print ${p.side}`}>
              <AssetLogo symbol={p.symbol} size={22} />
              <b>{p.symbol}</b>
              <span className={p.side === 'buy' ? 'od-up' : 'od-down'}>
                {p.side === 'buy' ? 'BUY' : 'SELL'}
              </span>
              <span className="od-print-size">{qty(p.size)}</span>
              <span className="od-print-price">{usd(p.price)}</span>
              <span className="od-print-effect">{p.effect}</span>
              <time dateTime={new Date(p.at).toISOString()}>
                {new Date(p.at).toLocaleTimeString('en-US', {
                  hour12: false,
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
            </div>
          ))
        ) : (
          <p className="od-note">Waiting for the first print.</p>
        )}
      </div>
    </Panel>
  );
}
