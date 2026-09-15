import history from '../../data/history.json';
export const marketRows = history.rows.filter((r) => r.date >= '2025-01-24');
export const DIVIDEND_DATE = '2025-03-12';
export const DIVIDEND = 0.01;
export const VOLATILITY = 0.45;
export function mark(date: string) {
  const row = marketRows.find((r) => r.date === date);
  if (!row) throw Error('Choose an available market session.');
  return row.close;
}
export function expiries(date: string) {
  return marketRows.filter((r) => r.date > date).map((r) => r.date);
}
