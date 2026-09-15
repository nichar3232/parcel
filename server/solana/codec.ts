import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import type { ChainPosition } from '../../lib/contracts/api';
import { units } from '../../lib/engine';
export const hash = (value: string) =>
  createHash('sha256').update(value).digest();
export const feed = hash('NVDA/USD:historical-daily-close-v1');
export const pk = (value: string | PublicKey) => new PublicKey(value);
export function u64(value: number | bigint | string) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
export function i64(value: number) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
}
export const key = (
  value: string | PublicKey,
  isWritable = false,
  isSigner = false,
): AccountMeta => ({ pubkey: pk(value), isWritable, isSigner });
export const instruction = (
  program: PublicKey,
  name: string,
  keys: AccountMeta[],
  body: Buffer = Buffer.alloc(0),
) =>
  new TransactionInstruction({
    programId: program,
    keys,
    data: Buffer.concat([hash(`global:${name}`).subarray(0, 8), body]),
  });
export function offerBytes(p: ChainPosition) {
  const t = p.terms;
  return Buffer.concat([
    u64(p.nonce),
    pk(p.holder).toBuffer(),
    Buffer.from([t.kind === 'put' ? 0 : 1]),
    u64(units(t.low)),
    u64(units(t.high)),
    u64(units(t.quantity)),
    u64(units(t.premium)),
    i64(p.expiry),
    i64(p.deadline),
  ]);
}
// US equities close at 16:00 America/New_York. The checked-in sample spans 2025 Q1.
export function historicalClose(date: string) {
  return (
    Date.parse(
      `${date}T${date >= '2025-03-09' && date < '2025-11-02' ? '20' : '21'}:00:00Z`,
    ) / 1000
  );
}
