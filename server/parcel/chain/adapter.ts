import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getMint,
  unpackAccount,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';
import type { Config } from '../../config';
import type { VaultPlan } from '../service';
import type { VaultBook } from '../../../lib/parcel/types';
import { UNDERLYINGS } from '../../../lib/parcel/universe';
import { chainGenesis } from '../ledger';
import { instruction, key, pk, u64, i64 } from '../../solana/codec';
import { actionBytes, assetIndex, bookBytes, bookHash, movedAsset } from './codec';
import { pinnedGenesisFailure } from '../../solana/network';
export interface PreparedVaultTransaction {
  raw: string;
  signature: string;
  lastValidHeight: number;
  ledger: string;
  stage: 'initialize' | 'execute';
}
export interface VaultChainAdapter {
  /* Receipts name the ledger they were produced on, so the coordinator reads
     it from the adapter rather than assuming the original private validator. */
  readonly network: 'localnet' | 'devnet';
  prepare(
    owner: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ): Promise<PreparedVaultTransaction | null>;
  broadcast(raw: string): Promise<void>;
  status(
    tx: PreparedVaultTransaction,
  ): Promise<'pending' | 'confirmed' | 'expired' | { error: string }>;
  verify(
    owner: string,
    book: VaultBook,
    revision: number,
  ): Promise<{ ledger: string; slot: number }>;
}
function base58(bytes: Uint8Array) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex')),
    s = '';
  while (n) {
    s = alphabet[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

/* This byte sequence already derives deployed test accounts. It is an
   identity boundary, not a display name, so changing it would orphan the
   existing validator ledger and every recoverable signed operation. */
export const SESSION_KEY_DOMAIN = Buffer.from([
  111, 100, 100, 108, 111, 116, 58, 118, 50,
]).toString('utf8');
/* Version-four ledgers hold every stock and live at their own addresses, so
   a session that opened a version-three vault is never read as one. */
const LEDGER_VERSION = 'v4';

/** The test capital each side starts with, per asset, in base units. */
const WALLET_SEED = (asset: string) =>
  asset === 'USDC' ? 10_000_000_000n : asset === 'NVDA' ? 25_000_000n : 5_000_000n;
const POOL_SEED = (asset: string) =>
  asset === 'USDC' ? 4_000_000_000_000n : 20_000_000_000n;
/** The ledger account: discriminator, owner, operator, ten mints, revision, book. */
const REVISION_OFFSET = 8 + 32 + 32 + 32 * (UNDERLYINGS.length + 1);
const BOOK_OFFSET = REVISION_OFFSET + 8;

export class ParcelAdapter implements VaultChainAdapter {
  readonly connection: Connection;
  readonly program: PublicKey;
  readonly network: 'localnet' | 'devnet';
  constructor(private config: Config) {
    if (!config.parcel) throw Error('Parcel chain configuration is missing.');
    this.network = config.network;
    this.program = pk(config.parcel.program);
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      /* A private validator that answers 429 is misconfigured, so the
         retry stays off there and the error surfaces. A shared public
         cluster rate limits as a matter of course, and refusing to retry
         turns an ordinary throttle into a failed vault operation. */
      disableRetryOnRateLimit: config.network === 'localnet',
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
    });
  }
  /** Every asset the vault holds, cash first, with its test mint. */
  private assets() {
    const p = this.config.parcel!;
    return [
      { asset: 'USDC', mint: pk(p.cashMint) },
      ...UNDERLYINGS.map((u) => ({
        asset: u.symbol,
        mint: pk(p.stockMints[u.symbol]),
      })),
    ];
  }
  private async accounts(session: string) {
    const operator = Keypair.fromSecretKey(
      Uint8Array.from(
        JSON.parse(
          await readFile(`${this.config.stateDir}/deployer.json`, 'utf8'),
        ),
      ),
    );
    if (operator.publicKey.toBase58() !== this.config.authority)
      throw Error('Wrong dedicated test operator.');
    const derive = (role: string) =>
      Keypair.fromSeed(
        createHmac('sha256', operator.secretKey)
          .update(`${SESSION_KEY_DOMAIN}:${LEDGER_VERSION}:${session}:${role}`)
          .digest(),
      );
    const owner = derive('owner'),
      ledger = derive('ledger');
    const [bank] = PublicKey.findProgramAddressSync(
      [Buffer.from('bank'), ledger.publicKey.toBuffer()],
      this.program,
    );
    const assets = this.assets().map((a) => ({
      ...a,
      wallet: getAssociatedTokenAddressSync(a.mint, owner.publicKey),
      pool: getAssociatedTokenAddressSync(a.mint, bank, true),
    }));
    return { operator, owner, ledger, bank, assets };
  }
  async health() {
    const genesis = await this.connection.getGenesisHash();
    const failure = pinnedGenesisFailure(genesis, this.config);
    if (failure) throw Error(`Parcel chain mode refused the RPC. ${failure}`);
    /* An absent mint is what an unprovisioned ledger looks like, and it is
       reported as a readiness failure rather than a token-library stack
       trace. Every other error is left to propagate: a throttled or
       unreachable RPC is a transient transport failure, and reporting it as
       "not provisioned" would send an operator to re-provision a ledger that
       is already correct. */
    const absent = (e: unknown) =>
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError;
    const readMint = (mint: PublicKey) =>
      getMint(this.connection, mint).catch((e) => {
        if (absent(e)) return null;
        throw e;
      });
    const assets = this.assets();
    const [program, ...mints] = await Promise.all([
      this.connection.getAccountInfo(this.program),
      ...assets.map((a) => readMint(a.mint)),
    ]);
    const authority = pk(this.config.authority);
    if (
      !program?.executable ||
      mints.some(
        (m) =>
          !m || m.decimals !== 6 || !m.mintAuthority?.equals(authority),
      ) ||
      new Set(assets.map((a) => a.mint.toBase58())).size !== assets.length
    )
      throw Error(
        `Parcel program or test mints are not ready on ${this.config.network}.`,
      );
  }
  /**
   * Give a new session its test capital: the owner's wallet and the vault's
   * escrow for every asset, created and minted by the operator. Idempotent,
   * so a retried initialization tops up only what is missing. These are
   * operator-only transactions and are not the session's recorded operation.
   */
  private async fund(a: Awaited<ReturnType<ParcelAdapter['accounts']>>) {
    const addresses = a.assets.flatMap((x) => [x.wallet, x.pool]);
    const infos = await this.connection.getMultipleAccountsInfo(addresses);
    const held = (i: number) => {
      const info = infos[i];
      return info ? unpackAccount(addresses[i], info).amount : 0n;
    };
    const work: TransactionInstruction[] = [];
    a.assets.forEach((x, i) => {
      for (const [address, owner, seed, have] of [
        [x.wallet, a.owner.publicKey, WALLET_SEED(x.asset), held(2 * i)],
        [x.pool, a.bank, POOL_SEED(x.asset), held(2 * i + 1)],
      ] as const) {
        if (have >= seed) continue;
        work.push(
          createAssociatedTokenAccountIdempotentInstruction(
            a.operator.publicKey,
            address,
            owner,
            x.mint,
          ),
          createMintToInstruction(
            x.mint,
            address,
            a.operator.publicKey,
            seed - have,
          ),
        );
      }
    });
    // Six token accounts per transaction keeps each under the size limit.
    for (let i = 0; i < work.length; i += 12) {
      const tx = new Transaction().add(...work.slice(i, i + 12));
      await sendAndConfirmTransaction(this.connection, tx, [a.operator], {
        commitment: 'confirmed',
      });
    }
  }
  async prepare(
    session: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ) {
    await this.health();
    const a = await this.accounts(session);
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
    ];
    const signers = [a.operator, a.owner];
    if (stage === 'initialize') {
      const existing = await this.connection.getAccountInfo(a.ledger.publicKey);
      if (existing) {
        await this.verify(session, plan.before, plan.revision);
        return null;
      }
      if (
        plan.revision !== 0 ||
        !bookBytes(plan.before).equals(bookBytes(chainGenesis()))
      )
        throw Error(
          'Onchain mode needs a fresh vault; existing sandbox balances are never silently migrated.',
        );
      await this.fund(a);
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: a.operator.publicKey,
          newAccountPubkey: a.ledger.publicKey,
          space: 65536,
          lamports:
            await this.connection.getMinimumBalanceForRentExemption(65536),
          programId: this.program,
        }),
        instruction(this.program, 'initialize_v4', [
          key(a.ledger.publicKey, true),
          key(a.owner.publicKey, false, true),
          key(a.operator.publicKey, false, true),
          key(a.bank),
          ...a.assets.map((x) => key(x.mint)),
        ]),
      );
      signers.push(a.ledger);
    } else {
      await this.verify(session, plan.before, plan.revision);
      // The token accounts are the asset this action moves between wallet
      // and vault; the program refuses any other asset moving.
      const moved = a.assets[assetIndex(movedAsset(plan))];
      // The reviewed price is authorized by the dedicated test maker; program checks
      // state revision, integer obligations and the complete resulting projection.
      const deadline = Math.floor(Date.now() / 1000) + 60;
      instructions.push(
        instruction(
          this.program,
          'execute_v4',
          [
            key(a.ledger.publicKey, true),
            key(a.owner.publicKey, false, true),
            key(a.operator.publicKey, false, true),
            key(a.bank),
            key(moved.wallet, true),
            key(moved.pool, true),
            key(TOKEN_PROGRAM_ID),
          ],
          Buffer.concat([
            u64(plan.revision),
            i64(deadline),
            actionBytes(plan),
            bookHash(plan.book),
          ]),
        ),
      );
    }
    const latest = await this.connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: a.operator.publicKey,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...instructions);
    tx.sign(...signers);
    const simulated = await this.connection.simulateTransaction(
      VersionedTransaction.deserialize(tx.serialize()),
      { sigVerify: true },
    );
    if (simulated.value.err)
      throw Error(
        `Parcel program rejected the prepared action: ${JSON.stringify(simulated.value.err)} ${(simulated.value.logs || []).slice(-5).join(' ')}`,
      );
    return {
      raw: tx.serialize().toString('base64'),
      signature: base58(tx.signature!),
      lastValidHeight: latest.lastValidBlockHeight,
      ledger: a.ledger.publicKey.toBase58(),
      stage,
    };
  }
  async broadcast(raw: string) {
    await this.connection.sendRawTransaction(Buffer.from(raw, 'base64'), {
      skipPreflight: false,
      maxRetries: 0,
    });
  }
  async status(tx: PreparedVaultTransaction) {
    const result = (
      await this.connection.getSignatureStatuses([tx.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (result?.err) return { error: JSON.stringify(result.err) };
    if (
      result?.confirmationStatus === 'confirmed' ||
      result?.confirmationStatus === 'finalized'
    )
      return 'confirmed';
    if (
      !result &&
      (await this.connection.getBlockHeight('finalized')) > tx.lastValidHeight
    )
      return 'expired';
    return 'pending';
  }
  async verify(session: string, book: VaultBook, revision: number) {
    const a = await this.accounts(session);
    const result = await this.connection.getAccountInfoAndContext(
      a.ledger.publicKey,
    );
    const data = result.value?.data;
    const expected = bookBytes(book);
    if (
      !result.value?.owner.equals(this.program) ||
      !data ||
      !data.subarray(8, 40).equals(a.owner.publicKey.toBuffer()) ||
      !data.subarray(40, 72).equals(a.operator.publicKey.toBuffer()) ||
      data.readBigUInt64LE(REVISION_OFFSET) !== BigInt(revision) ||
      !data
        .subarray(BOOK_OFFSET, BOOK_OFFSET + expected.length)
        .equals(expected)
    )
      throw Error(
        'Onchain vault does not match the prepared ledger revision. Execution stopped.',
      );
    return { ledger: a.ledger.publicKey.toBase58(), slot: result.context.slot };
  }
}
