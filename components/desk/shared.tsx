'use client';
import { ChartContainer } from '@/components/ui/chart';
import { money, payout, type Terms, validate } from '@/lib/engine';
import {
  Activity,
  ArrowUpRight,
  Check,
  Clock,
  Landmark,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
export type Page =
  | 'Portfolio'
  | 'Trade'
  | 'Build'
  | 'Finance'
  | 'Activity'
  | 'Maker'
  | 'Replay';
export const nav = [
  { name: 'Portfolio', icon: Wallet },
  { name: 'Trade', icon: ArrowUpRight },
  { name: 'Build', icon: SlidersHorizontal },
  { name: 'Finance', icon: Landmark },
  { name: 'Activity', icon: Activity },
] as const;
export const initialTerms: Terms = {
  kind: 'put',
  low: 120,
  high: 140,
  quantity: 100,
  premium: 400,
  expiry: '2025-01-27',
  scenario: 'deepseek',
};
export const short = (s: string) =>
  s.length > 15 ? `${s.slice(0, 6)}…${s.slice(-5)}` : s;
export const day = (s: string) =>
  new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const statusName: Record<string, string> = {
  requested: 'Awaiting maker',
  funded: 'Funded offer',
  active: 'Active',
  awaiting: 'Awaiting data',
  settled: 'Ready to claim',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>
      {['active', 'closed', 'settled'].includes(status) ? (
        <Check size={11} />
      ) : (
        <Clock size={11} />
      )}{' '}
      {statusName[status] || status}
    </span>
  );
}
export function Metric({
  label,
  value,
  note,
  positive = false,
}: {
  label: string;
  value: string;
  note?: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <strong className={positive ? 'positive' : ''}>{value}</strong>
      {note && <span className="subtle">{note}</span>}
    </div>
  );
}
export const chartConfig = {
  price: { label: 'NVDA close', color: '#c4e59a' },
  protected: { label: 'Stock + hedge PnL', color: '#c4e59a' },
  stock: { label: 'Stock PnL', color: '#768270' },
  payout: { label: 'Derivative payout', color: '#a6cce3' },
  net: { label: 'Derivative net PnL', color: '#c4e59a' },
};
export function PayoffChart({
  terms,
  entry,
  combined = false,
}: {
  terms: Terms;
  entry: number;
  combined?: boolean;
}) {
  let error = '';
  try {
    validate(terms);
  } catch (e) {
    error = (e as Error).message;
  }
  const data = error
    ? []
    : Array.from({ length: 61 }, (_, i) => {
        const price = +(
          terms.low * 0.6 +
          (i * (terms.high * 1.25 - terms.low * 0.6)) / 60
        ).toFixed(2);
        return {
          price,
          net: payout(terms, price) - terms.premium,
          payout: payout(terms, price),
          stock: (price - entry) * terms.quantity,
          protected:
            (price - entry) * terms.quantity +
            payout(terms, price) -
            terms.premium,
        };
      });
  return (
    <div className="payoff-chart">
      {error ? (
        <div className="empty">
          Set valid strikes and quantity to see your payoff.
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="chart">
          <LineChart
            data={data}
            margin={{ top: 15, right: 12, bottom: 10, left: 5 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#333b2d"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="price"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => `$${Math.round(v)}`}
              tickLine={false}
              axisLine={false}
              minTickGap={35}
            />
            <YAxis
              width={58}
              tickFormatter={(v) =>
                Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
              }
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1a2217',
                border: '1px solid #48533c',
                borderRadius: 10,
              }}
              formatter={(v, n) => [
                money(Number(v)),
                chartConfig[n as keyof typeof chartConfig]?.label || n,
              ]}
              labelFormatter={(v) => `At ${money(Number(v))} NVDA`}
            />
            <ReferenceArea
              x1={terms.low}
              x2={terms.high}
              fill="#a9d484"
              fillOpacity={0.05}
            />
            <ReferenceLine y={0} stroke="#67745c" />
            <ReferenceLine
              x={terms.low}
              stroke="#58654b"
              strokeDasharray="4 4"
            />
            <ReferenceLine
              x={terms.high}
              stroke="#58654b"
              strokeDasharray="4 4"
            />
            {combined ? (
              <>
                <Line
                  dataKey="stock"
                  stroke="#768270"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="5 5"
                />
                <Line
                  dataKey="protected"
                  stroke="#c4e59a"
                  strokeWidth={2.5}
                  dot={false}
                />
              </>
            ) : (
              <>
                <Line
                  dataKey="payout"
                  stroke="#a6cce3"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="5 5"
                />
                <Line
                  dataKey="net"
                  stroke="#c4e59a"
                  strokeWidth={2.5}
                  dot={false}
                />
              </>
            )}
          </LineChart>
        </ChartContainer>
      )}
      <div className="chart-legend">
        <span>
          <i />
          {combined ? 'Stock + hedge net PnL' : 'Derivative net PnL'}
        </span>
        <span>
          <i className="muted-line" />
          {combined ? 'Stock only PnL' : 'Derivative payout'}
        </span>
        <span>NVDA price at expiry →</span>
      </div>
    </div>
  );
}
