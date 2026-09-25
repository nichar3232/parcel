/* The genesis pin is the only thing standing between a test deployment and a
   real one, so both adapters resolve it here rather than keeping their own
   copy of the rule. Mainnet is refused outright: this product has no
   production custody claim, and no configuration may opt into it. */
/* Full 32-byte base58 hashes, as `getGenesisHash` returns them. The retired
   constants were truncated to 32 characters, so the mainnet comparison could
   never be true and the refusal below never fired. It was masked while the
   configuration refused every network but the private validator; it is load
   bearing now that devnet is configurable. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export interface PinnedNetwork {
  network: 'localnet' | 'devnet';
  expectedGenesis: string;
}

/* An explicit pin is always required. `network` only says which cluster the
   operator meant; the pin says which ledger they actually provisioned, and a
   devnet pin that is not devnet's own genesis is a misconfiguration, not a
   private validator that happens to answer. */
export function pinnedGenesisFailure(
  genesis: string,
  config: PinnedNetwork,
): string | null {
  if (genesis === MAINNET_GENESIS) return 'Mainnet is never an accepted target.';
  if (!config.expectedGenesis)
    return 'No genesis is pinned. Set SOLANA_GENESIS_HASH to the provisioned ledger.';
  if (genesis !== config.expectedGenesis)
    return 'RPC genesis does not match the explicitly pinned test network.';
  if (config.network === 'devnet' && genesis !== DEVNET_GENESIS)
    return 'Devnet mode requires devnet genesis.';
  if (config.network === 'localnet' && genesis === DEVNET_GENESIS)
    return 'Localnet mode is pinned to a private validator, not devnet.';
  return null;
}
