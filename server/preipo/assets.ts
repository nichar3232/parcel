import { readMints } from '../../lib/preipo/chain';
import { fetchPreStocks } from '../../lib/preipo/providers/prestocks';
import type { RetryOptions } from '../../lib/preipo/providers/retry';
import { registry } from '../../lib/preipo/registry';
import { resolveAssets } from '../../lib/preipo/resolve';
import type {
  ProviderQuote,
  ResolvedAsset,
  SolanaNetwork,
} from '../../lib/preipo/types';

export interface PreIpoConfig {
  /** Read-only RPC used solely to verify mint facts. */
  verifyRpcUrl: string;
  verifyNetwork: SolanaNetwork;
  /** Deployed covered-call program, when one exists. */
  programId: string | null;
  /** USDC mint for the configured network. */
  usdcMint: string | null;
}

export interface AssetsPayload {
  network: SolanaNetwork;
  programId: string | null;
  usdcMint: string | null;
  /** True only when a program is configured; the UI must not offer to sign otherwise. */
  executionEnabled: boolean;
  /** Every instrument currently published by PreStocks, including ones still awaiting registry review. */
  catalog: ProviderQuote[];
  assets: ResolvedAsset[];
  /** Per-source failures, surfaced rather than swallowed. */
  warnings: string[];
  refreshedAt: string;
}

const TTL_MS = 60_000;
let cache: { at: number; payload: AssetsPayload } | null = null;

/**
 * The last quotes each provider successfully served.
 *
 * The publisher feed is public and returns the occasional 5xx. Dropping every
 * price for a minute is the wrong trade: prices are informational, and a
 * recent mark is more useful than an empty screen. A failed read therefore
 * falls back to the last successful catalog in this process.
 */
let lastGood: ProviderQuote[] | null = null;

/**
 * Resolve the curated registry against the chain and the PreStocks API.
 *
 * Provider outages degrade to "no price" rather than failing the request:
 * prices are informational. A failure to read the chain, by contrast, leaves
 * every asset unverified and therefore not escrowable, which is the correct
 * conservative outcome.
 */
export async function loadAssets(
  config: PreIpoConfig,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
  retry?: RetryOptions,
): Promise<AssetsPayload> {
  if (cache && now - cache.at < TTL_MS) return cache.payload;

  const warnings: string[] = [];
  let catalog: ProviderQuote[] = [];
  try {
    catalog = await fetchPreStocks(fetchImpl, undefined, retry);
    lastGood = catalog;
  } catch {
    if (lastGood) catalog = lastGood;
    else
      warnings.push(
        'PreStocks prices are not available yet. Prices are informational and never settle a contract.',
      );
  }

  let onchain = new Map();
  try {
    onchain = await readMints(
      registry.map((a) => a.mint),
      { rpcUrl: config.verifyRpcUrl, network: config.verifyNetwork },
    );
  } catch (e) {
    warnings.push(
      `Mint verification RPC unavailable: ${(e as Error).message}. No asset can be offered until its mint is verified.`,
    );
  }

  const payload: AssetsPayload = {
    network: config.verifyNetwork,
    programId: config.programId,
    usdcMint: config.usdcMint,
    executionEnabled: Boolean(config.programId && config.usdcMint),
    catalog,
    assets: resolveAssets(registry, onchain, catalog),
    warnings,
    refreshedAt: new Date(now).toISOString(),
  };
  cache = { at: now, payload };
  return payload;
}

export const resetAssetCache = () => {
  cache = null;
  lastGood = null;
};
