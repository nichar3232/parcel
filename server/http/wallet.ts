import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { Session, Store } from '../db/store';
import { ApiError, object } from './errors';

/*
 * Sign in with a Solana wallet. The desk asks the server for a one-time
 * message, the wallet signs it (a signature, not a transaction: nothing is
 * sent or spent), and the server checks the ed25519 signature against the
 * address before tying that address to the session. The vault stays the
 * session's; signing in is what opens it.
 */

const pending = new Map<string, { message: string; expires: number }>();

/** DER prefix of an ed25519 SubjectPublicKeyInfo; the raw key follows. */
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function walletChallenge(session: Session, origin: string) {
  const nonce = randomBytes(16).toString('hex');
  const message = [
    'Sign in to Parcel',
    '',
    `Desk: ${origin}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    '',
    'This signature proves you own this wallet. It is not a transaction and costs nothing.',
  ].join('\n');
  pending.set(session.id, { message, expires: Date.now() + 5 * 60_000 });
  return { message };
}

export function walletSignIn(store: Store, session: Session, input: unknown) {
  const i = object(input);
  const address = typeof i.address === 'string' ? i.address : '';
  const signature = typeof i.signature === 'string' ? i.signature : '';
  const challenge = pending.get(session.id);
  pending.delete(session.id);
  if (!challenge || challenge.expires < Date.now())
    throw new ApiError(400, 'WALLET_CHALLENGE', 'Sign-in expired. Try again.');
  let key: Buffer;
  try {
    key = Buffer.from(new PublicKey(address).toBytes());
  } catch {
    throw new ApiError(400, 'WALLET_ADDRESS', 'That is not a Solana address.');
  }
  const ok = verify(
    null,
    Buffer.from(challenge.message, 'utf8'),
    createPublicKey({
      key: Buffer.concat([SPKI, key]),
      format: 'der',
      type: 'spki',
    }),
    Buffer.from(signature, 'base64'),
  );
  if (!ok)
    throw new ApiError(
      401,
      'WALLET_SIGNATURE',
      'The signature does not match that wallet.',
    );
  store.setSessionWallet(session.id, address);
  return { address };
}
