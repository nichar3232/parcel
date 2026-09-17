import { fetchJsonWithRetry, type RetryOptions } from './retry';
import type { ProviderQuote } from '../types';

export const TESSERA_ENDPOINT =
  'https://rest-api.tessera.pe/v1/public/token-details';

/**
 * Verified 2026-09-16 against the live endpoint. The response is a bare
 * JSON array; each element looked like:
 *
 * {"id":"T-OpenAI","name":"T-OpenAI","symbol":"T-OpenAI","code":"tOpenAI",
 *  "sector":"Artificial Intelligence",
 *  "mint":"oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ",
 *  "markPrice":812.79,"holders":8259,"markValuation":950000000000}
 *
 * Note the mint field is `mint`. PreStocks uses `contract_address`. The two
 * payloads are NOT interchangeable and each has its own parser.
 *
 * The response carries no decimals and no token program, so those are read
 * from the chain and never inferred from this document.
 */
interface TesseraRow {
  id: unknown;
  name: unknown;
  symbol: unknown;
  code: unknown;
  sector: unknown;
  mint: unknown;
  markPrice: unknown;
  holders: unknown;
  markValuation: unknown;
}

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !v.trim())
    throw new Error(`Tessera: "${field}" must be a non-empty string.`);
  return v;
};
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parseTessera(
  body: unknown,
  fetchedAt: string,
): ProviderQuote[] {
  if (!Array.isArray(body))
    throw new Error('Tessera: expected a JSON array of token details.');
  return body.map((raw) => {
    const row = raw as TesseraRow;
    return {
      provider: 'tessera' as const,
      symbol: str(row.symbol, 'symbol'),
      displayName: str(row.name, 'name'),
      mint: str(row.mint, 'mint'),
      // Informational only. Contracts settle on fixed integer USDC amounts.
      markPriceUsd: numOrNull(row.markPrice),
      meta: {
        code: typeof row.code === 'string' ? row.code : null,
        sector: typeof row.sector === 'string' ? row.sector : null,
        holders: numOrNull(row.holders),
        markValuation: numOrNull(row.markValuation),
      },
      fetchedAt,
    };
  });
}

export async function fetchTessera(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  retry?: RetryOptions,
): Promise<ProviderQuote[]> {
  const body = await fetchJsonWithRetry(
    'Tessera',
    TESSERA_ENDPOINT,
    fetchImpl,
    signal,
    retry,
  );
  return parseTessera(body, new Date().toISOString());
}
