import { writeFileSync } from 'node:fs';
import { DIVIDEND_DATE, historyOf, marketRows } from '../lib/parcel/market';
import { UNDERLYINGS } from '../lib/parcel/universe';
/**
 * The replay every underlying settles on, compiled into the program: one
 * committed close per session per stock, in `UNDERLYINGS` order. Hourly
 * test ticks carry the session's close forward, so the program derives
 * them from the session dates instead of holding an expanded table.
 */
const epoch = Date.parse(marketRows[0].date);
const hours = (date: string) => (Date.parse(date) - epoch) / 3600000;
const row = (values: number[]) =>
  Array.from(
    { length: Math.ceil(values.length / 10) },
    (_, i) => '    ' + values.slice(i * 10, i * 10 + 10).join(', ') + ',',
  ).join('\n');
const closes = UNDERLYINGS.map((u) => {
  const rows = historyOf(u.symbol);
  if (
    rows.length !== marketRows.length ||
    rows.some((r, i) => r.date !== marketRows[i].date)
  )
    throw Error(`${u.symbol} does not share the replay calendar.`);
  return `    // ${u.symbol}\n    &[\n${row(rows.map((r) => Math.round(r.close * 1e6)))}\n    ],`;
});
writeFileSync(
  new URL('../programs/parcel/src/market.rs', import.meta.url),
  `// Generated from committed daily closes by scripts/generate-parcel-market.ts.
/// The stocks the vault holds, in the order the book indexes them.
pub const STOCKS: usize = ${UNDERLYINGS.length};
/// Each stock's committed close at each replay session.
pub const CLOSES: [&[u64]; STOCKS] = [
${closes.join('\n')}
];
/// Each replay session, in hours after the epoch. Hourly test ticks exist
/// for the 23 hours after every session but the last.
pub const SESSIONS: &[u32] = &[
${row(marketRows.map((r) => hours(r.date)))}
];
/// ${marketRows[0].date}T00:00:00Z, the replay's first session, in Unix milliseconds.
/// \`SESSIONS\` counts from here; every date the program holds is a Unix-ms instant.
pub const REPLAY_EPOCH: i64 = ${epoch.toLocaleString('en-US').replaceAll(',', '_')};
pub const HOUR: i64 = 3_600_000;
/// The replay's last observation, in hours after the epoch.
/// Anything later is the live market, priced by the operator's attestation.
pub const REPLAY_HOURS: i64 = ${hours(marketRows.at(-1)!.date)};
/// ${DIVIDEND_DATE}, the replay's dividend observation.
pub const DIVIDEND_DATE: i64 = REPLAY_EPOCH + ${hours(DIVIDEND_DATE)} * HOUR;
`,
);
