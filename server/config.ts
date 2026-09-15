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
  expirySeconds: number;
  secureCookie: boolean;
}
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): Config {
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
  return {
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
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    chainEnabled: env.CHAIN_ENABLED !== 'false',
    expirySeconds,
    secureCookie: env.COOKIE_SECURE === 'true',
  };
}
