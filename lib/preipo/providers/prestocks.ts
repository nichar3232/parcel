import type { ProviderQuote } from '../types';

export const PRESTOCKS_ENDPOINT = 'https://prestocks.com/api/prestocks';
export const PRESTOCKS_PRODUCTS = 'https://prestocks.com/products';

/**
 * Verified 2026-09-16 against the live endpoint. The response is a bare
 * JSON array; each element looked like:
 *
 * {"name":"Anthropic PreStocks","symbol":"ANTHROPIC","description":"...",
 *  "image":"https://www.prestocks.com/logos/anthropic.png",
 *  "external_url":"https://www.prestocks.com/anthropic",
 *  "contract_address":"Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
 *  "markPrice":1007.05683324,"markValuation":1649903811610,
 *  "tokenPrice":956.7206391833798,"impliedValuation":1567435895506,
 *  "supply":7381.972255745}
 *
 * The mint field is `contract_address`, NOT `mint`, and the payload carries
 * both a `markPrice` and a distinct `tokenPrice`. Neither is a settlement
 * oracle. `supply` is a decimal token count, not base units.
 *
 * No decimals and no token program are published, so both are read from
 * the chain.
 */
interface PreStocksRow {
  name: unknown;
  symbol: unknown;
  description: unknown;
  image: unknown;
  external_url: unknown;
  contract_address: unknown;
  markPrice: unknown;
  markValuation: unknown;
  tokenPrice: unknown;
  impliedValuation: unknown;
  supply: unknown;
}

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !v.trim())
    throw new Error(`PreStocks: "${field}" must be a non-empty string.`);
  return v;
};
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parsePreStocks(
  body: unknown,
  fetchedAt: string,
): ProviderQuote[] {
  if (!Array.isArray(body))
    throw new Error('PreStocks: expected a JSON array of products.');
  return body.map((raw) => {
    const row = raw as PreStocksRow;
    return {
      provider: 'prestocks' as const,
      symbol: str(row.symbol, 'symbol'),
      displayName: str(row.name, 'name'),
      mint: str(row.contract_address, 'contract_address'),
      markPriceUsd: numOrNull(row.markPrice),
      meta: {
        tokenPrice: numOrNull(row.tokenPrice),
        markValuation: numOrNull(row.markValuation),
        impliedValuation: numOrNull(row.impliedValuation),
        supplyTokens: numOrNull(row.supply),
        externalUrl:
          typeof row.external_url === 'string' ? row.external_url : null,
        image: typeof row.image === 'string' ? row.image : null,
      },
      fetchedAt,
    };
  });
}

export async function fetchPreStocks(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ProviderQuote[]> {
  const res = await fetchImpl(PRESTOCKS_ENDPOINT, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`PreStocks responded ${res.status}.`);
  return parsePreStocks(await res.json(), new Date().toISOString());
}
