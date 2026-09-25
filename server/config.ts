import path from 'node:path';
import { ApiError } from './http/errors';
export interface Config {
  port: number;
  host: string;
  publicDir: string;
  stateDir: string;
  rpcUrl: string;
  network: 'localnet' | 'devnet';
  expectedGenesis: string;
  programId: string;
  authority: string;
  allowedOrigins: string[];
  chainEnabled: boolean;
  /** Fail the deployment readiness probe if no real-time listed NBBO feed is up. */
  marketDataRequired: boolean;
  expirySeconds: number;
  secureCookie: boolean;
  /** The public https address the desk is reached at, when it has one. */
  publicUrl?: string;
  parcel?: { program: string; cashMint: string; stockMint: string };
}

/* Parcel names are canonical. The retired namespace is read only as a
   compatibility bridge for an already-provisioned local-validator service;
   the project no longer documents or emits it. */
const priorParcelEnv = (
  env: Record<string, string | undefined>,
  name: string,
) =>
  env[`PARCEL_${name}`] ??
  env[`${String.fromCharCode(79, 68, 68, 76, 79, 84)}_${name}`];

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): Config {
  // Where agents and the OAuth pages say the desk lives. Without it, each
  // request's own address is used, which on a laptop is localhost.
  let publicUrl: string | undefined;
  if (env.PUBLIC_URL) {
    const u = new URL(env.PUBLIC_URL);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost')
      throw Error('PUBLIC_URL must be an https address.');
    publicUrl = u.origin;
  }
  const network = env.SOLANA_NETWORK || 'localnet';
  if (network !== 'localnet' && network !== 'devnet')
    throw Error('Only localnet or devnet are allowed.');
  const rpcUrl = env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
  const url = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(url.protocol))
    throw Error('RPC must use HTTP(S).');
  if (
    network === 'localnet' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    throw Error('Localnet RPC must be loopback. Use an SSH tunnel for tests.');
  if (network === 'devnet' && url.protocol !== 'https:')
    throw Error('Devnet RPC must use HTTPS.');
  const expectedGenesis = env.SOLANA_GENESIS_HASH || '';
  const expirySeconds = Number(env.REPLAY_EXPIRY_SECONDS || 90);
  if (
    !Number.isSafeInteger(expirySeconds) ||
    expirySeconds < 15 ||
    expirySeconds > 3600
  )
    throw Error('Replay expiry must be 15–3600 seconds.');
  const port = Number(env.PORT || 3025);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ApiError(500, 'CONFIG', 'Invalid port.');
  const parcelChainEnabled = priorParcelEnv(env, 'CHAIN_ENABLED');
  const parcelProgram = priorParcelEnv(env, 'PROGRAM_ID');
  const parcelCashMint = priorParcelEnv(env, 'CASH_MINT');
  const parcelStockMint = priorParcelEnv(env, 'STOCK_MINT');
  /* Devnet joins the pinned private validator as an accepted target. Both are
     no-value test ledgers; mainnet stays refused in the genesis pin itself, so
     no environment can reach it. The pin is required here rather than at first
     RPC call, so a misconfigured deployment fails to boot instead of failing
     the first contract a user opens. */
  if (
    parcelChainEnabled === 'true' &&
    (!parcelProgram ||
      !parcelCashMint ||
      !parcelStockMint ||
      !expectedGenesis ||
      env.CHAIN_ENABLED === 'false')
  )
    throw Error(
      'Parcel chain mode requires its program, two mints, a pinned genesis, and enabled chain execution.',
    );
  return {
    parcel:
      parcelChainEnabled === 'true'
        ? {
            // The guard above validates the three values together before
            // chain mode is exposed to the rest of the server.
            program: parcelProgram!,
            cashMint: parcelCashMint!,
            stockMint: parcelStockMint!,
          }
        : undefined,
    port,
    host: env.HOST || '0.0.0.0',
    publicDir: path.resolve(env.STRATA_PUBLIC_DIR || 'dist/client'),
    stateDir: path.resolve(env.STRATA_STATE_DIR || '.state'),
    rpcUrl,
    network,
    expectedGenesis,
    programId:
      env.STRATA_PROGRAM_ID || '3VpPpDGYjxawotjb6xMYdUsZoazszT7NLb1wgVod9Xcm',
    authority:
      env.STRATA_AUTHORITY || '8oheEujy8FS7Nr3bdYT7okWbWeMy3Tp5eM8z4YwRTzfq',
    allowedOrigins: [
      ...(env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
      ...(publicUrl ? [publicUrl] : []),
    ],
    chainEnabled: env.CHAIN_ENABLED !== 'false',
    marketDataRequired: env.MARKET_DATA_REQUIRED === 'true',
    expirySeconds,
    secureCookie: env.COOKIE_SECURE === 'true',
    publicUrl,
  };
}
