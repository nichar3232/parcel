import history from '../../data/history.json';
export const marketRows = history.rows.filter((r) => r.date >= '2025-01-24');
// Hourly observations carry forward that day's committed close. They are test
// clock ticks, never claimed to be historical intraday market prices. Daily
// indices remain stable for archived evidence; appended indices sort by time.
export const clockRows = [
  ...marketRows,
  ...marketRows.slice(0, -1).flatMap((r) =>
    Array.from({ length: 23 }, (_, i) => ({
      ...r,
      date: `${r.date}T${String(i + 1).padStart(2, '0')}:00:00Z`,
    })),
  ),
];
export const clockDates = clockRows.map((r) => r.date).sort();
export const DIVIDEND_DATE = '2025-03-12';
export const DIVIDEND = 0.01;
export const VOLATILITY = 0.45;
export function mark(date: string) {
  const row = clockRows.find((r) => r.date === date);
  if (!row) throw Error('Choose an available market session.');
  return row.close;
}
export function expiries(date: string) {
  return marketRows.filter((r) => r.date > date).map((r) => r.date);
}

export function shortExpiries(date: string) {
  const now = Date.parse(date);
  return clockDates.filter(
    (d) =>
      d.includes('T') &&
      Date.parse(d) > now &&
      Date.parse(d) <= now + 24 * 3600000,
  );
}

export function selectableExpiries(date: string) {
  const hourly = shortExpiries(date);
  return [
    ...new Set([
      ...[0, 3, 7, 11, 22].map((i) => hourly[i]).filter(Boolean),
      ...expiries(date),
    ]),
  ].sort();
}
