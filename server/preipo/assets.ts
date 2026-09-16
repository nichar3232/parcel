import { readMints } from '../../lib/preipo/chain';
import { fetchPreStocks } from '../../lib/preipo/providers/prestocks';
import { fetchTessera } from '../../lib/preipo/providers/tessera';
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
  assets: ResolvedAsset[];
  /** Per-source failures, surfaced rather than swallowed. */
  warnings: string[];
  refreshedAt: string;
}

const TTL_MS = 60_000;
let cache: { at: number; payload: AssetsPayload } | null = null;

/**
 * Resolve the curated registry against the chain and both provider APIs.
 *
 * Provider outages degrade to "no price" rather than failing the request:
 * prices are informational. A failure to read the chain, by contrast, leaves
 * every asset unverified and therefore not escrowable, which is the correct
 * conservative outcome.
 */
export async function loadAssets(
  config: PreIpoConfig,
  now = Date.now(),
): Promise<AssetsPayload> {
  if (cache && now - cache.at < TTL_MS) return cache.payload;

  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];

  const settled = await Promise.allSettled([fetchTessera(), fetchPreStocks()]);
  const labels = ['Tessera', 'PreStocks'];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes.push(...r.value);
    else
      warnings.push(
        `${labels[i]} price feed unavailable: ${(r.reason as Error).message}. Prices are informational and never settle a contract.`,
      );
  });

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
    assets: resolveAssets(registry, onchain, quotes),
    warnings,
    refreshedAt: new Date(now).toISOString(),
  };
  cache = { at: now, payload };
  return payload;
}

export const resetAssetCache = () => {
  cache = null;
};
