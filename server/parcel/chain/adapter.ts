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
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getMint,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';
import type { Config } from '../../config';
import type { VaultPlan } from '../service';
import type { VaultBook } from '../../../lib/parcel/types';
import { chainGenesis } from '../ledger';
import { instruction, key, pk, u64, i64 } from '../../solana/codec';
import { actionBytes, bookBytes, bookHash } from './codec';
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
          .update(`${SESSION_KEY_DOMAIN}:${session}:${role}`)
          .digest(),
      );
    const owner = derive('owner'),
      ledger = derive('ledger'),
      cash = pk(this.config.parcel!.cashMint),
      stock = pk(this.config.parcel!.stockMint);
    const [bank] = PublicKey.findProgramAddressSync(
      [Buffer.from('bank'), ledger.publicKey.toBuffer()],
      this.program,
    );
    const poolCash = getAssociatedTokenAddressSync(cash, bank, true),
      poolStock = getAssociatedTokenAddressSync(stock, bank, true),
      walletCash = getAssociatedTokenAddressSync(cash, owner.publicKey),
      walletStock = getAssociatedTokenAddressSync(stock, owner.publicKey);
    return {
      operator,
      owner,
      ledger,
      cash,
      stock,
      bank,
      poolCash,
      poolStock,
      walletCash,
      walletStock,
    };
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
    const readMint = (mint: string) =>
      getMint(this.connection, pk(mint)).catch((e) => {
        if (absent(e)) return null;
        throw e;
      });
    const [program, cash, stock] = await Promise.all([
      this.connection.getAccountInfo(this.program),
      readMint(this.config.parcel!.cashMint),
      readMint(this.config.parcel!.stockMint),
    ]);
    if (
      !cash ||
      !stock ||
      !program?.executable ||
      cash.decimals !== 6 ||
      stock.decimals !== 6 ||
      cash.address.equals(stock.address) ||
      !cash.mintAuthority?.equals(pk(this.config.authority)) ||
      !stock.mintAuthority?.equals(pk(this.config.authority))
    )
      throw Error(
        `Parcel program or test mints are not ready on ${this.config.network}.`,
      );
  }
  async prepare(
    session: string,
    plan: VaultPlan,
    stage: 'initialize' | 'execute',
  ) {
    await this.health();
    const a = await this.accounts(session);
    const keys = [
      key(a.ledger.publicKey, true),
      key(a.owner.publicKey, false, true),
      key(a.operator.publicKey, false, true),
      key(a.cash),
      key(a.stock),
      key(a.bank),
      key(a.poolCash, true),
      key(a.poolStock, true),
      key(a.walletCash, true),
      key(a.walletStock, true),
    ];
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
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: a.operator.publicKey,
          newAccountPubkey: a.ledger.publicKey,
          space: 65536,
          lamports:
            await this.connection.getMinimumBalanceForRentExemption(65536),
          programId: this.program,
        }),
      );
      for (const [address, mint, owner, n] of [
        [a.poolCash, a.cash, a.bank, 4_000_000_000_000n],
        [a.poolStock, a.stock, a.bank, 20_000_000_000n],
        [a.walletCash, a.cash, a.owner.publicKey, 10_000_000_000n],
        [a.walletStock, a.stock, a.owner.publicKey, 25_000_000n],
      ] as const) {
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            a.operator.publicKey,
            address,
            owner,
            mint,
          ),
          createMintToInstruction(mint, address, a.operator.publicKey, n),
        );
      }
      instructions.push(instruction(this.program, 'initialize_v3', keys));
      signers.push(a.ledger);
    } else {
      await this.verify(session, plan.before, plan.revision);
      // The reviewed price is authorized by the dedicated test maker; program checks
      // state revision, integer obligations and the complete resulting projection.
      const deadline = Math.floor(Date.now() / 1000) + 60;
      instructions.push(
        instruction(
          this.program,
          'execute_v3',
          [...keys, key(TOKEN_PROGRAM_ID)],
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
    if (
      !result.value?.owner.equals(this.program) ||
      !data ||
      !data.subarray(8, 40).equals(a.owner.publicKey.toBuffer()) ||
      !data.subarray(40, 72).equals(a.operator.publicKey.toBuffer()) ||
      data.readBigUInt64LE(136) !== BigInt(revision) ||
      !data.subarray(144, 144 + bookBytes(book).length).equals(bookBytes(book))
    )
      throw Error(
        'Onchain vault does not match the prepared ledger revision. Execution stopped.',
      );
    return { ledger: a.ledger.publicKey.toBase58(), slot: result.context.slot };
  }
}
