'use client';
import { Metric, Status, chartConfig, day } from '@/components/desk/shared';
import { Button } from '@/components/ui/button';
import { ChartContainer } from '@/components/ui/chart';
import type { Desk } from '@/hooks/desk/use-desk';
import { money, signed } from '@/lib/engine';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Info,
  Link as LinkIcon,
  Play,
  Shield,
} from 'lucide-react';
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts';
export function PortfolioView({
  book,
  current,
  claims,
  entry,
  scenario,
  rows,
  index,
  navigate,
  totalLocked,
  realized,
  setModal,
  active,
  setSelected,
  remote,
}: Pick<
  Desk,
  | 'book'
  | 'current'
  | 'claims'
  | 'entry'
  | 'scenario'
  | 'rows'
  | 'index'
  | 'navigate'
  | 'totalLocked'
  | 'realized'
  | 'setModal'
  | 'active'
  | 'setSelected'
  | 'terms'
  | 'remote'
>) {
  return (
    <>
      <section className="hero-grid">
        <div className="panel equity-panel">
          <div className="flex-between">
            <span className="label">Portfolio reference value</span>
            <span className="subtle">PRACTICE ACCOUNT</span>
          </div>
          <div className="big-number">
            {money(book.holderCash + 100 * current.close + claims).slice(0, -3)}
            <span>
              {money(book.holderCash + 100 * current.close + claims).slice(-3)}
            </span>
          </div>
          <div className="value-caption">
            <span
              className={current.close - entry >= 0 ? 'positive' : 'negative'}
            >
              {signed((current.close - entry) * 100)}
            </span>
            <span>
              stock move since {day(scenario.entry).replace(', 2025', '')}
            </span>
          </div>
          <ChartContainer className="portfolio-chart" config={chartConfig}>
            <AreaChart
              data={rows.slice(0, index + 1)}
              margin={{ top: 15, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a9d483" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#a9d483" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin - 4', 'dataMax + 4']} />
              <XAxis dataKey="date" hide />
              <Tooltip
                contentStyle={{
                  background: '#1b2418',
                  border: '1px solid #48533c',
                  borderRadius: 8,
                }}
                labelFormatter={(v) => day(String(v))}
                formatter={(v) => [money(Number(v)), 'NVDA close']}
              />
              <Area
                dataKey="close"
                type="linear"
                stroke="#b5db90"
                strokeWidth={2}
                fill="url(#priceFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
          <div className="chart-dates">
            <span>{day(rows[0].date)}</span>
            <span>{day(current.date)}</span>
          </div>
          <div className="panel-footnote">
            Cash + reference holdings + fixed unpaid claims. Unsettled
            derivatives are unmarked.
          </div>
        </div>
        <div className="panel replay-feature">
          <div className="eyebrow">THE REPLAY LAB</div>
          <h2>
            What if you had
            <br />a little protection?
          </h2>
          <p>
            Replay NVIDIA’s DeepSeek selloff with real historical prices. Build
            a hedge. See the difference.
          </p>
          <Button className="primary" onClick={() => navigate('Replay')}>
            Enter the replay <ArrowRight size={16} />
          </Button>
          <div className="replay-feature-foot">
            <Play size={13} /> JANUARY 2025 — NVDA
          </div>
        </div>
      </section>
      <section className="metrics-grid">
        <Metric
          label="Cash available"
          value={money(book.holderCash)}
          note="Demo USDC — holder wallet"
        />
        <Metric
          label="Contract collateral"
          value={money(totalLocked)}
          note="Maker-funded — held in escrow"
        />
        <Metric
          label="Realized derivative PnL"
          value={signed(realized)}
          note="Settled positions only"
          positive={realized >= 0}
        />
        <Metric
          label="Debt"
          value="$0.00"
          note="No connected lending position"
        />
      </section>
      <section className="panel holdings-panel">
        <div className="section-heading">
          <h2>
            Your holdings <span className="count">2</span>
          </h2>
          <button className="text-link" onClick={() => setModal('risk')}>
            View allocation <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Quantity</th>
                <th>Reference price</th>
                <th>Value</th>
                <th>Allocation</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td aria-label="Asset">
                  <div className="asset-cell">
                    <div className="asset-icon">N</div>
                    <div>
                      <strong>NVIDIA</strong>
                      <p>NVDA — test stock exposure</p>
                    </div>
                  </div>
                </td>
                <td>100.00</td>
                <td>{money(current.close)}</td>
                <td>{money(current.close * 100)}</td>
                <td>
                  <span className="allocation-dot" />
                  100% available
                </td>
                <td>
                  <Button variant="outline" onClick={() => navigate('Build')}>
                    Protect <ArrowRight size={12} />
                  </Button>
                </td>
              </tr>
              <tr>
                <td aria-label="Asset">
                  <div className="asset-cell">
                    <div className="asset-icon usdc">$</div>
                    <div>
                      <strong>Demo USDC</strong>
                      <p>Practice settlement currency</p>
                    </div>
                  </div>
                </td>
                <td>
                  {book.holderCash.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </td>
                <td>
                  $1.00 <span className="subtle">assumed</span>
                </td>
                <td>{money(book.holderCash)}</td>
                <td>
                  <span className="allocation-dot" />
                  Available cash
                </td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel-footnote">
          <Info size={12} />
          NVDA is the historical equity reference. Test stock exposure is not an
          issuer’s NVDAx token.
        </div>
      </section>
      <section className="panel positions-panel">
        <div className="section-heading">
          <h2>
            Your protection <span className="count">{active.length}</span>
          </h2>
          <span className="subtle">Fully reserved — cash settled</span>
        </div>
        {active.length ? (
          active.map((p) => (
            <button
              className="position-row"
              key={p.id}
              onClick={() => setSelected(p.id)}
            >
              <div className="round-icon">
                <Shield size={18} />
              </div>
              <div>
                <strong>
                  NVDA{' '}
                  {p.terms.kind === 'put'
                    ? 'downside protection'
                    : 'capped upside'}
                </strong>
                <p>
                  {money(p.terms.low, 0)}–{money(p.terms.high, 0)} —{' '}
                  {p.terms.quantity} shares — {day(p.terms.expiry)}
                </p>
              </div>
              <Status status={p.status} />
              <ChevronRight size={16} />
            </button>
          ))
        ) : (
          <div className="empty-position">
            <Shield size={27} />
            <div>
              <h3>Your stocks have room for a safety net.</h3>
              <p>Define a protection range without selling your holdings.</p>
            </div>
            <Button variant="outline" onClick={() => navigate('Build')}>
              Build protection <ArrowRight size={13} />
            </Button>
          </div>
        )}
      </section>
      {remote && (
        <section className="panel positions-panel">
          <div className="section-heading">
            <h2>Your Solana test contract</h2>
            <span className="pill">{remote.network}</span>
          </div>
          <button className="position-row" onClick={() => setModal('execute')}>
            <div className="round-icon">
              <LinkIcon size={18} />
            </div>
            <div>
              <strong>
                {remote.terms.quantity} NVDA {remote.terms.kind} spread
              </strong>
              <p>
                {money(remote.escrow)} test USDC in escrow — last read slot{' '}
                {remote.lastSlot}
              </p>
            </div>
            <Status status={remote.status} />
            <ChevronRight size={16} />
          </button>
          <p className="field-note">
            Actual test-chain balances are separate from the practice totals
            above.
          </p>
        </section>
      )}
      <div className="bottom-insight">
        <LinkIcon size={17} />
        <div>
          <strong>More than a stock in a wallet.</strong>
          <span>
            Keep the exposure. Define the payoff. Verify the collateral.
          </span>
        </div>
        <button className="text-link" onClick={() => setModal('about')}>
          Why onchain <ArrowRight size={13} />
        </button>
      </div>
    </>
  );
}
