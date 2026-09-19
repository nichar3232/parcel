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
    `pub const DIVIDEND_DATE: u16 = ${clockRows.findIndex((r) => r.date === DIVIDEND_DATE)};\n`,
);
