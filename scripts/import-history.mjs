import fs from 'node:fs';
import crypto from 'node:crypto';
const raw = fs.readFileSync(
  new URL('../data/nvda-yahoo-raw.json', import.meta.url),
);
const provenance = JSON.parse(
  fs.readFileSync(new URL('../data/provenance.json', import.meta.url), 'utf8'),
);
if (crypto.createHash('sha256').update(raw).digest('hex') !== provenance.sha256)
  throw Error('Retained source checksum mismatch.');
const d = JSON.parse(raw).chart.result[0],
  q = d.indicators.quote[0];
const rows = d.timestamp.map((t, i) => ({
  date: new Date(t * 1000).toISOString().slice(0, 10),
  open: +q.open[i].toFixed(2),
  high: +q.high[i].toFixed(2),
  low: +q.low[i].toFixed(2),
  close: +q.close[i].toFixed(2),
  volume: q.volume[i],
}));
fs.writeFileSync(
  new URL('../data/history.json', import.meta.url),
  JSON.stringify(
    {
      symbol: 'NVDA',
      source: 'Yahoo Finance chart API',
      sourceUrl:
        'https://query2.finance.yahoo.com/v8/finance/chart/NVDA?period1=1735689600&period2=1743724800&interval=1d',
      retrievedAt: provenance.retrievedAt,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
      priceType:
        'Daily OHLC, provider close, not adjusted close. Historical equity reference; not NVDAx token prices.',
      policy:
        'Historical daily-close replay v1. All observations precommitted; no live or intraday settlement claim.',
      rows,
    },
    null,
    2,
  ),
);
