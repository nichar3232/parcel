import history from '../data/history.json';
export const scenarios = [
  {
    id: 'deepseek',
    name: 'The DeepSeek shock',
    tag: 'GAP RISK',
    start: '2025-01-17',
    entry: '2025-01-24',
    end: '2025-01-31',
    expiry: '2025-01-27',
    low: 120,
    high: 140,
    premium: 400,
    description:
      'An overnight AI narrative reset. NVIDIA falls sharply as the cash market reopens.',
    lesson:
      'Stocks trade onchain around the clock. Their reference market still closes. Cash-settled protection covers the contracted price range, even through a gap.',
  },
  {
    id: 'earnings',
    name: 'After the earnings bell',
    tag: 'EVENT RISK',
    start: '2025-02-18',
    entry: '2025-02-26',
    end: '2025-03-07',
    expiry: '2025-02-27',
    low: 115,
    high: 130,
    premium: 350,
    description:
      'Replay the trading session after NVIDIA’s February earnings release.',
    lesson:
      'An earnings event can move the underlying faster than a holder can rebalance. Full pre-funding makes the contracted payout independent of a later margin call.',
  },
  {
    id: 'rebound',
    name: 'The January rebound',
    tag: 'UPSIDE',
    start: '2025-01-10',
    entry: '2025-01-14',
    end: '2025-01-24',
    expiry: '2025-01-22',
    low: 130,
    high: 145,
    premium: 500,
    description: 'A capped call spread through NVIDIA’s January recovery.',
    lesson:
      'Bounded upside needs no unbounded short exposure. Both sides know the maximum payout before committing capital.',
  },
];
export { history };
export const rowsFor = (id: string) => {
  const s = scenarios.find((s) => s.id === id) || scenarios[0];
  return history.rows.filter((r) => r.date >= s.start && r.date <= s.end);
};
export const priceOn = (date: string) => {
  const row = history.rows.find((r) => r.date === date);
  if (!row) throw Error('No committed session at this date.');
  return row.close;
};
