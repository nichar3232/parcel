import { evaluateMint } from './policy';
import { registry } from './registry';
import type {
  OnchainMint,
  ProviderQuote,
  RegistryAsset,
  ResolvedAsset,
} from './types';

/**
 * Join the curated registry with chain facts and provider prices.
 *
 * Precedence is fixed and not negotiable:
 *   1. The chain decides what the token IS (program, decimals, extensions).
 *   2. The registry decides whether we have reviewed it.
 *   3. The provider API contributes a price label and nothing else.
 *
 * A provider quote is matched by mint, never by symbol, so a renamed or
 * duplicated symbol cannot attach one issuer's price to another's token.
 */
export function resolveAssets(
  assets: RegistryAsset[],
  onchain: Map<string, OnchainMint | null>,
  quotes: ProviderQuote[],
): ResolvedAsset[] {
  return assets.map((asset) => {
    const chain = onchain.get(asset.mint) ?? null;
    const { verdict, registryMismatch } = evaluateMint(asset, chain);
    const quote =
      quotes.find(
        (q) => q.provider === asset.provider && q.mint === asset.mint,
      ) || null;
    return { asset, onchain: chain, quote, verdict, registryMismatch };
  });
}

export const defaultAssets = () => registry;

/** Only assets that passed every check may back a new contract. */
export const escrowable = (resolved: ResolvedAsset[]) =>
  resolved.filter((r) => r.verdict.escrowSupported);
