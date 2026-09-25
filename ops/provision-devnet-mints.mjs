#!/usr/bin/env node
// Give the devnet deployment a six-decimal no-value test mint for every
// underlying the desk writes on, under the program's compiled operator, and
// record them in the devnet environment as PARCEL_STOCK_MINTS.
//
// Existing mints are kept: NVDA stays on the mint the deployment already has
// (PARCEL_STOCK_MINT), and any symbol already listed in PARCEL_STOCK_MINTS is
// left alone, so re-running only creates what is missing.
//
//   STATE  the devnet state directory (deployer.json, devnet.env)
//   RPC    a dedicated devnet endpoint
import { readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';
import { UNDERLYINGS } from '../lib/parcel/universe.ts';

const state = process.env.STATE || `${process.env.HOME}/.parcel-devnet/state`;
const envFile = `${state}/devnet.env`;
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const rpc = process.env.RPC || env.SOLANA_RPC_URL;
const operator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${state}/deployer.json`, 'utf8'))),
);
if (operator.publicKey.toBase58() !== env.STRATA_AUTHORITY)
  throw Error('deployer.json is not the operator devnet.env names.');
const connection = new Connection(rpc, 'confirmed');
const mints = Object.fromEntries(
  (env.PARCEL_STOCK_MINTS || '')
    .split(',')
    .filter(Boolean)
    .map((pair) => pair.split('=')),
);
if (env.PARCEL_STOCK_MINT && !mints.NVDA) mints.NVDA = env.PARCEL_STOCK_MINT;
for (const u of UNDERLYINGS) {
  if (mints[u.symbol]) {
    console.log(`${u.symbol.padEnd(11)} ${mints[u.symbol]} (kept)`);
    continue;
  }
  const mint = await createMint(
    connection,
    operator,
    operator.publicKey,
    null,
    6,
  );
  mints[u.symbol] = mint.toBase58();
  console.log(`${u.symbol.padEnd(11)} ${mints[u.symbol]} (created)`);
}
const line = `PARCEL_STOCK_MINTS=${UNDERLYINGS.map((u) => `${u.symbol}=${mints[u.symbol]}`).join(',')}`;
const lines = readFileSync(envFile, 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('PARCEL_STOCK_MINTS='));
const at = lines.findIndex((l) => l.startsWith('PARCEL_STOCK_MINT='));
lines.splice(at < 0 ? lines.length : at + 1, 0, line);
writeFileSync(envFile, lines.join('\n'));
writeFileSync(
  `${state}/parcel-devnet-mints.json`,
  JSON.stringify({ cash: env.PARCEL_CASH_MINT, stocks: mints }, null, 2) + '\n',
);
console.log(`\n${line}\nwritten to ${envFile}`);
