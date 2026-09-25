import nvda from '../../data/history.json';
import anduril from '../../data/replay/anduril.json';
import anthropic from '../../data/replay/anthropic.json';
import figureai from '../../data/replay/figureai.json';
import kalshi from '../../data/replay/kalshi.json';
import neuralink from '../../data/replay/neuralink.json';
import openai from '../../data/replay/openai.json';
import polymarket from '../../data/replay/polymarket.json';
import spacex from '../../data/replay/spacex.json';

export interface SessionRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Underlying {
  symbol: string;
  name: string;
  /** Where the token comes from; an equity is its own issuer. */
  provider: 'equity' | 'prestocks';
  /** The model volatility every quote on this underlying is priced at. */
  volatility: number;
  /** True when the replay path was struck rather than printed. */
  simulated: boolean;
  /** The sponsor's mark the path was anchored to, when simulated. */
  anchor: number | null;
  rows: SessionRow[];
}

/**
 * Everything the desk can write a contract on.
 *
 * NVDA is a real price file. The rest are the pre-IPO tokens the
 * registry has verified, each on a precommitted path struck from the
 * sponsor's mark: the sandbox agrees in advance what every session
 * will close at, which is the only way a settlement can be checked
 * later. All twelve share one session calendar, so an expiry means
 * the same day whichever one it is written on.
 */
const token = (
  file: (typeof openai | typeof anthropic) & {
    provider: string;
  },
): Underlying => ({
  symbol: file.symbol,
  name: file.name,
  provider: file.provider as 'prestocks',
  volatility: file.volatility,
  simulated: true,
  anchor: file.anchor.price,
  rows: file.rows,
});

export const UNDERLYINGS: Underlying[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    provider: 'equity',
    volatility: 0.45,
    simulated: false,
    anchor: null,
    rows: nvda.rows,
  },
  token(openai),
  token(anthropic),
  token(spacex),
  token(anduril),
  token(neuralink),
  token(figureai),
  token(kalshi),
  token(polymarket),
];

export const DEFAULT_UNDERLYING = 'NVDA';

const bySymbol = new Map(UNDERLYINGS.map((u) => [u.symbol, u]));

export function underlying(symbol: string): Underlying {
  const u = bySymbol.get(symbol);
  if (!u) throw Error(`Choose a supported underlying, not ${symbol}.`);
  return u;
}

export const isUnderlying = (symbol: unknown): symbol is string =>
  typeof symbol === 'string' && bySymbol.has(symbol);

/** The company, for a token, or the issuer's name. */
export const nameOf = (symbol: string) => bySymbol.get(symbol)?.name ?? symbol;
