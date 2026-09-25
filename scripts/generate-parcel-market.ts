import { writeFileSync } from 'node:fs';
import { clockRows, DIVIDEND_DATE } from '../lib/parcel/market';
const array = (name: string, type: string, values: number[]) =>
  `pub const ${name}: &[${type}] = &[\n${Array.from({ length: Math.ceil(values.length / 12) }, (_, i) => '    ' + values.slice(i * 12, i * 12 + 12).join(', ') + ',').join('\n')}\n];\n`;
writeFileSync(
  new URL('../programs/parcel/src/market.rs', import.meta.url),
  '// Generated from committed daily closes. Hourly test ticks carry the daily close forward.\n' +
    array(
      'PRICES',
      'u64',
      clockRows.map((r) => Math.round(r.close * 1e6)),
    ) +
    array(
      'HOURS',
      'u32',
      clockRows.map(
        (r) => (Date.parse(r.date) - Date.parse(clockRows[0].date)) / 3600000,
      ),
    ) +
    // Dates are Unix-ms instants counted from the replay's first session.
    `/// ${clockRows[0].date}T00:00:00Z, the replay's first session, in Unix milliseconds.\n` +
    `/// \`HOURS\` counts from here; every date the program holds is a Unix-ms instant.\n` +
    `pub const REPLAY_EPOCH: i64 = ${Date.parse(clockRows[0].date).toLocaleString('en-US').replaceAll(',', '_')};\n` +
    'pub const HOUR: i64 = 3_600_000;\n' +
    `/// The replay's last observation, in hours after the epoch.\n` +
    '/// Anything later is the live market, priced by the operator\'s attestation.\n' +
    `pub const REPLAY_HOURS: i64 = ${Math.max(...clockRows.map((r) => (Date.parse(r.date) - Date.parse(clockRows[0].date)) / 3600000))};\n` +
    `/// ${DIVIDEND_DATE}, the replay's dividend observation.\n` +
    `pub const DIVIDEND_DATE: i64 = REPLAY_EPOCH + ${(Date.parse(DIVIDEND_DATE) - Date.parse(clockRows[0].date)) / 3600000} * HOUR;\n`,
);
