'use client';
import { Status, chartConfig, day } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import { ChartContainer } from '@/components/ui/chart';
import type { Desk } from '@/hooks/desk/use-desk';
import { money, payout, signed } from '@/lib/engine';
import { history, scenarios } from '@/lib/scenarios';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Info,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
export function ReplayView({
  scenarioId,
  selectScenario,
  scenario,
  current,
  stockPnl,
  entry,
  rows,
  index,
  replayTerms,
  playing,
  setIndex,
  setPlaying,
  protection,
  hedgePnl,
  setSelected,
  navigate,
  basis,
  setBasis,
}: Pick<
  Desk,
  | 'scenarioId'
  | 'selectScenario'
  | 'scenario'
  | 'current'
  | 'stockPnl'
  | 'entry'
  | 'rows'
  | 'index'
  | 'replayTerms'
  | 'playing'
  | 'setIndex'
  | 'setPlaying'
  | 'protection'
  | 'hedgePnl'
  | 'setSelected'
  | 'navigate'
  | 'basis'
  | 'setBasis'
>) {
  return (
    <>
      <div className="scenario-tabs">
        {scenarios.map((s, i) => (
          <button
            key={s.id}
            className={s.id === scenarioId ? 'selected' : ''}
            onClick={() => selectScenario(s.id)}
          >
            <span>0{i + 1}</span>
            <div>
              <strong>{s.name}</strong>
              <small>{s.tag}</small>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      <div className="replay-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NVDA · HISTORICAL DAILY CLOSE</span>
              <h2>{scenario.name}</h2>
            </div>
            <span className="pill">{day(current.date)}</span>
          </div>
          <div className="replay-price">
            {money(current.close)}
            <span className={stockPnl >= 0 ? 'positive' : 'negative'}>
              {((current.close / entry - 1) * 100).toFixed(2)}%{' '}
              <small>since entry</small>
            </span>
          </div>
          <ChartContainer className="replay-chart" config={chartConfig}>
            <AreaChart
              data={rows.slice(0, index + 1)}
              margin={{ top: 20, right: 10, bottom: 10, left: 0 }}
            >
              <defs>
                <linearGradient id="replayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b5db90" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#b5db90" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="#30382c"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => d.slice(5).replace('-', '/')}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[
                  Math.floor(Math.min(...rows.map((r) => r.low)) / 10) * 10,
                  Math.ceil(Math.max(...rows.map((r) => r.high)) / 10) * 10,
                ]}
                width={45}
                tickFormatter={(v) => `$${v}`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#1b2418',
                  border: '1px solid #48533c',
                  borderRadius: 8,
                }}
                labelFormatter={(v) => day(String(v))}
                formatter={(v) => [money(Number(v)), 'NVDA close']}
              />
              <ReferenceLine
                y={replayTerms.high}
                stroke="#758d5d"
                strokeDasharray="4 4"
              />
              <ReferenceLine
                y={replayTerms.low}
                stroke="#758d5d"
                strokeDasharray="4 4"
              />
              <Area
                dataKey="close"
                type="linear"
                stroke="#c4e59a"
                strokeWidth={2.5}
                fill="url(#replayFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
          <div className="replay-controls">
            <Button
              variant="outline"
              size="icon"
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              onClick={() => {
                if (index === rows.length - 1) setIndex(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </Button>
            <input
              aria-label="Historical session"
              type="range"
              min="0"
              max={rows.length - 1}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(+e.target.value);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rewind replay"
              onClick={() => {
                setPlaying(false);
                setIndex(0);
              }}
            >
              <RotateCcw size={15} />
            </Button>
          </div>
          <div className="chart-dates">
            <span>{day(rows[0].date)}</span>
            <span>One step = one trading session</span>
            <span>{day(rows.at(-1)!.date)}</span>
          </div>
          <p className="replay-caption">{scenario.description}</p>
        </section>
        <section className="panel replay-outcome">
          <span className="eyebrow">
            {protection ? 'YOUR FUNDED STRUCTURE' : 'HYPOTHETICAL STRUCTURE'}
          </span>
          <h2>
            {replayTerms.kind === 'put'
              ? 'Protection, in perspective.'
              : 'Upside, with a limit.'}
          </h2>
          <div className="outcome-row">
            <span>Stock only PnL</span>
            <strong className={stockPnl < 0 ? 'negative' : 'positive'}>
              {signed(stockPnl)}
            </strong>
          </div>
          <div className="outcome-row highlight">
            <span>Stock + hedge net PnL</span>
            <strong>{signed(stockPnl + hedgePnl)}</strong>
          </div>
          <div className="detail-row">
            <span>Derivative payout</span>
            <strong>{money(payout(replayTerms, current.close))}</strong>
          </div>
          <div className="detail-row">
            <span>Total premium</span>
            <strong>−{money(replayTerms.premium)}</strong>
          </div>
          <div className="detail-row">
            <span>Protection range</span>
            <strong>
              {money(replayTerms.low, 0)}–{money(replayTerms.high, 0)}
            </strong>
          </div>
          <p className="field-note">
            As-if-expired scenario values at this session’s price. This is not a
            historical option price or a mark-to-market. {replayTerms.quantity}{' '}
            shares; zero fees.
          </p>
          {protection ? (
            <>
              <Status status={protection.status} />
              <Button
                className="primary full"
                onClick={() => setSelected(protection.id)}
              >
                Open your position <ArrowRight size={14} />
              </Button>
            </>
          ) : (
            <Button className="primary full" onClick={() => navigate('Build')}>
              Build this structure <ArrowRight size={14} />
            </Button>
          )}
        </section>
      </div>
      <div className="replay-bottom">
        <section className="panel lesson">
          <div className="round-icon">
            <BookOpen size={20} />
          </div>
          <div>
            <span className="eyebrow">THE ONCHAIN GAP</span>
            <h3>
              {scenario.tag === 'GAP RISK'
                ? 'A 24/7 token. A market that sleeps.'
                : scenario.tag === 'EVENT RISK'
                  ? 'A price shock should not become a funding shock.'
                  : 'A transparent maximum, on both sides.'}
            </h3>
            <p>{scenario.lesson}</p>
          </div>
        </section>
        <section className="panel">
          <h3>Challenge the hedge</h3>
          <label htmlFor="basis">
            Simulated stock-token discount <strong>{basis}%</strong>
          </label>
          <input
            id="basis"
            type="range"
            min="0"
            max="30"
            value={basis}
            onChange={(e) => setBasis(+e.target.value)}
          />
          <div className="detail-row">
            <span>Additional unhedged token loss</span>
            <strong className="negative">
              −{money((current.close * replayTerms.quantity * basis) / 100)}
            </strong>
          </div>
          <p className="field-note">
            A deliberately simulated basis shock. The derivative follows NVDA;
            it cannot insure the issuer or token price.
          </p>
        </section>
      </div>
      <details className="source-details">
        <summary>
          <Info size={13} />
          Data provenance and replay assumptions
        </summary>
        <p>
          {history.priceType} Snapshot retrieved{' '}
          {history.retrievedAt.slice(0, 10)}. No corporate actions are modeled
          inside these selected windows. Each replay uses a stored provider
          daily close, not the design’s proposed 15-minute-before-close live
          observation.
        </p>
        <a href={history.sourceUrl} target="_blank" rel="noreferrer">
          Yahoo Finance source <ExternalLink size={12} />
        </a>
        <code>SHA-256 {history.sha256}</code>
        <p>
          Past prices are visible by design. Premiums, fills, wallets and
          capital in practice mode are simulated. This is an educational
          scenario comparison, not a trading backtest.
        </p>
      </details>
    </>
  );
}
