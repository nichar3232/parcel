import type { MintExtension, OnchainMint, SolanaNetwork } from './types';

/**
 * Read-only mint verification.
 *
 * This is deliberately separate from the execution chain service in
 * `server/solana`, which fails closed on anything but localnet/devnet. Reading
 * a mainnet mint account to check its decimals and extensions is not custody
 * and moves nothing; it must never be used to authorise a transfer. The
 * network is carried on every result so a caller cannot lose track of which
 * chain a fact came from.
 */

const KNOWN_EXTENSIONS = new Set<string>([
  'transferFeeConfig',
  'transferFeeAmount',
  'metadataPointer',
  'tokenMetadata',
  'permanentDelegate',
  'transferHook',
  'transferHookAccount',
  'pausableConfig',
  'pausableAccount',
  'defaultAccountState',
  'confidentialTransferMint',
  'confidentialTransferFeeConfig',
  'scaledUiAmountConfig',
  'nonTransferable',
  'interestBearingConfig',
  'groupPointer',
  'groupMemberPointer',
  'memoTransfer',
  'cpiGuard',
  'immutableOwner',
]);

interface ParsedExtension {
  extension?: unknown;
  state?: unknown;
}

/** Parse a `getAccountInfo` jsonParsed mint payload into verified facts. */
export function parseMintAccount(
  mint: string,
  network: SolanaNetwork,
  value: unknown,
  observedAt = new Date().toISOString(),
): OnchainMint | null {
  if (!value || typeof value !== 'object') return null;
  const account = value as {
    owner?: unknown;
    data?: { parsed?: { type?: unknown; info?: unknown } };
  };
  const parsed = account.data?.parsed;
  if (parsed?.type !== 'mint') return null;
  const info = (parsed.info || {}) as Record<string, unknown>;
  const owner = typeof account.owner === 'string' ? account.owner : '';
  if (!owner) return null;

  const rawExtensions = Array.isArray(info.extensions)
    ? (info.extensions as ParsedExtension[])
    : [];
  const names = rawExtensions
    .map((e) => (typeof e.extension === 'string' ? e.extension : ''))
    .filter(Boolean);

  const extensions = names.filter((n) =>
    KNOWN_EXTENSIONS.has(n),
  ) as MintExtension[];
  const unknownExtensions = names.filter((n) => !KNOWN_EXTENSIONS.has(n));

  const feeExt = rawExtensions.find((e) => e.extension === 'transferFeeConfig');
  const feeState = (feeExt?.state || {}) as Record<string, unknown>;
  const newer = (feeState.newerTransferFee || {}) as Record<string, unknown>;
  const bps =
    typeof newer.transferFeeBasisPoints === 'number'
      ? newer.transferFeeBasisPoints
      : null;
  // jsonParsed renders u64 maxima as either a string or a number.
  const rawMaximum = newer.maximumFee;
  const maximum =
    typeof rawMaximum === 'string'
      ? rawMaximum
      : typeof rawMaximum === 'number'
        ? String(rawMaximum)
        : null;

  const pausable = rawExtensions.find((e) => e.extension === 'pausableConfig');

  return {
    mint,
    network,
    tokenProgram: owner,
    decimals: typeof info.decimals === 'number' ? info.decimals : -1,
    supplyBaseUnits: typeof info.supply === 'string' ? info.supply : '0',
    mintAuthority:
      typeof info.mintAuthority === 'string' ? info.mintAuthority : null,
    freezeAuthority:
      typeof info.freezeAuthority === 'string' ? info.freezeAuthority : null,
    extensions,
    unknownExtensions,
    transferFeeBasisPoints: bps,
    transferFeeMaximum: maximum,
    hasPermanentDelegate: names.includes('permanentDelegate'),
    pausable: Boolean(pausable),
    hasTransferHook: names.includes('transferHook'),
    observedAt,
  };
}

export interface MintReaderOptions {
  rpcUrl: string;
  network: SolanaNetwork;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Fetch and verify a batch of mints in one RPC round trip. */
export async function readMints(
  mints: string[],
  { rpcUrl, network, fetchImpl = fetch, signal }: MintReaderOptions,
): Promise<Map<string, OnchainMint | null>> {
  const out = new Map<string, OnchainMint | null>();
  if (!mints.length) return out;
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getMultipleAccounts',
      params: [mints, { encoding: 'jsonParsed' }],
    }),
  });
  if (!res.ok) throw new Error(`Mint RPC responded ${res.status}.`);
  const body = (await res.json()) as {
    error?: { message?: string };
    result?: { value?: unknown[] };
  };
  if (body.error) throw new Error(`Mint RPC error: ${body.error.message}`);
  const values = body.result?.value || [];
  mints.forEach((mint, i) => {
    out.set(mint, parseMintAccount(mint, network, values[i]));
  });
  return out;
}
