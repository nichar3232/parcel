import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  unpackAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import history from '../../data/history.json';
import type {
  ChainAction,
  ChainPosition,
  Health,
} from '../../lib/contracts/api';
import { maximum, units } from '../../lib/engine';
import type { Config } from '../config';
import { pinnedGenesisFailure } from './network';
import { ApiError, friendlyChainError } from '../http/errors';
import {
  feed,
  historicalClose,
  i64,
  instruction,
  key,
  offerBytes,
  pk,
  u64,
} from './codec';
export interface Prepared {
  position: ChainPosition;
  signature: string;
  raw: string;
  lastValidHeight: number;
}
export interface ChainAdapter {
  health(): Promise<Health['chain']>;
  prepare(
    owner: string,
    action: ChainAction,
    position: ChainPosition | undefined,
    input: Record<string, unknown>,
  ): Promise<Prepared>;
  broadcast(raw: string): Promise<void>;
  confirmation(
    signature: string,
    height: number,
  ): Promise<'pending' | 'confirmed' | 'expired' | { error: string }>;
  read(position: ChainPosition): Promise<ChainPosition>;
  proof(signature: string): Promise<unknown>;
}
function base58(bytes: Uint8Array) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let s = '';
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
export class SolanaAdapter implements ChainAdapter {
  readonly connection: Connection;
  readonly program: PublicKey;
  constructor(private config: Config) {
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      /* A private validator that answers 429 is misconfigured, so the
         retry stays off there and the error surfaces. A shared public
         cluster rate limits as a matter of course, and refusing to retry
         turns an ordinary throttle into a failed vault operation. */
      disableRetryOnRateLimit: config.network === 'localnet',
      fetch: async (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
    });
    this.program = pk(config.programId);
  }
  private async mint() {
    return pk(
      (
        JSON.parse(
          await readFile(
            `${this.config.stateDir}/${this.config.network}-mint.json`,
            'utf8',
          ),
        ) as { mint: string }
      ).mint,
    );
  }
  private async authority() {
    const k = Keypair.fromSecretKey(
      Uint8Array.from(
        JSON.parse(
          await readFile(`${this.config.stateDir}/deployer.json`, 'utf8'),
        ) as number[],
      ),
    );
    if (k.publicKey.toBase58() !== this.config.authority)
      throw Error('Configured test authority does not match its key.');
    return k;
  }
  private wallet(authority: Keypair, owner: string, role: string) {
    return Keypair.fromSeed(
      createHmac('sha256', authority.secretKey)
        .update(`strata:v2:${owner}:${role}`)
        .digest(),
    );
  }
  async health(): Promise<Health['chain']> {
    if (!this.config.chainEnabled)
      return {
        ready: false,
        network: this.config.network,
        reason: 'Chain execution is disabled.',
      };
    try {
      const genesis = await this.connection.getGenesisHash();
      const failure = pinnedGenesisFailure(genesis, this.config);
      if (failure) throw Error(failure);
      const [program, mint, authority, slot, clock] = await Promise.all([
        this.connection.getAccountInfo(this.program),
        this.mint(),
        this.authority(),
        this.connection.getSlot(),
        this.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY),
      ]);
      if (!program?.executable)
        throw Error('The configured program is not deployed.');
      const info = await getMint(this.connection, mint);
      if (
        info.decimals !== 6 ||
        !info.mintAuthority?.equals(authority.publicKey)
      )
        throw Error(
          'The six-decimal test mint is not controlled by the configured demo authority.',
        );
      if ((await this.connection.getBalance(authority.publicKey)) < 20_000_000)
        throw Error('Dedicated test fee payer has insufficient test SOL.');
      if (!clock || clock.data.length < 40)
        throw Error('Solana clock is unavailable.');
      const chainTime = Number(clock.data.readBigInt64LE(32));
      return { ready: true, network: this.config.network, slot, chainTime };
    } catch (e) {
      return {
        ready: false,
        network: this.config.network,
        reason: (e as Error).message,
      };
    }
  }
  async prepare(
    owner: string,
    action: ChainAction,
    p: ChainPosition | undefined,
    input: Record<string, unknown>,
  ): Promise<Prepared> {
    const health = await this.health();
    if (!health.ready)
      throw new ApiError(
        503,
        'CHAIN_UNAVAILABLE',
        health.reason || 'Chain unavailable.',
      );
    const authority = await this.authority(),
      holder = this.wallet(authority, owner, 'holder'),
      maker = this.wallet(authority, owner, 'maker'),
      mint = await this.mint();
    const holderCash = getAssociatedTokenAddressSync(mint, holder.publicKey),
      makerCash = getAssociatedTokenAddressSync(mint, maker.publicKey);
    const ix = (
      name: string,
      keys: Parameters<typeof instruction>[2],
      body?: Buffer,
    ) => instruction(this.program, name, keys, body);
    const ixs: TransactionInstruction[] = [],
      signers: Keypair[] = [authority];
    if (action === 'fund') {
      const t = input.terms as ChainPosition['terms'];
      if (maximum(t) > 50000 || t.premium > 10000)
        throw new ApiError(
          400,
          'DEMO_LIMIT',
          'Test offers support up to 50,000 reserve and 10,000 premium.',
        );
      const sample = history.rows.find((r) => r.date === t.expiry);
      if (!sample)
        throw new ApiError(
          400,
          'INVALID_EXPIRY',
          'No historical observation exists on that date.',
        );
      const market = Keypair.generate(),
        nonce = randomBytes(8).readBigUInt64LE(),
        id = randomBytes(20).toString('hex');
      const [offer] = PublicKey.findProgramAddressSync(
        [Buffer.from('offer'), maker.publicKey.toBuffer(), u64(nonce)],
        this.program,
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), offer.toBuffer()],
        this.program,
      );
      const time = health.chainTime;
      if (time === undefined)
        throw new ApiError(
          503,
          'CHAIN_CLOCK',
          'The chain clock is unavailable.',
        );
      const expiry = time + this.config.expirySeconds;
      p = {
        id,
        network: this.config.network,
        programId: this.program.toBase58(),
        mint: mint.toBase58(),
        holder: holder.publicKey.toBase58(),
        maker: maker.publicKey.toBase58(),
        offer: offer.toBase58(),
        vault: vault.toBase58(),
        market: market.publicKey.toBase58(),
        terms: t,
        nonce: nonce.toString(),
        expiry,
        chainTime: time,
        deadline: expiry - 10,
        historicalAt: historicalClose(t.expiry),
        price: sample.close,
        transactions: [],
        status: 'prepared',
        buyerPayout: 0,
        buyerClaimed: false,
        makerClaimed: false,
        escrow: 0,
        lastSlot: health.slot!,
        updatedAt: new Date().toISOString(),
      };
      for (const [wallet, cash, amount] of [
        [maker.publicKey, makerCash, units(maximum(t))],
        [holder.publicKey, holderCash, units(t.premium)],
      ] as const) {
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            authority.publicKey,
            cash,
            wallet,
            mint,
          ),
          createMintToInstruction(
            mint,
            cash,
            authority.publicKey,
            BigInt(amount),
          ),
        );
      }
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: maker.publicKey,
          lamports:
            (await this.connection.getMinimumBalanceForRentExemption(245)) +
            (await this.connection.getMinimumBalanceForRentExemption(165)) +
            (await this.connection.getMinimumBalanceForRentExemption(0)),
        }),
        ix(
          'create_market',
          [
            key(market.publicKey, true, true),
            key(authority.publicKey, true, true),
            key(mint),
            key(SystemProgram.programId),
          ],
          Buffer.concat([
            feed,
            Buffer.from(history.sha256, 'hex'),
            u64(units(sample.close)),
            i64(p.historicalAt),
            i64(expiry),
          ]),
        ),
        ix(
          'fund_offer',
          [
            key(offer, true),
            key(market.publicKey),
            key(mint),
            key(vault, true),
            key(makerCash, true),
            key(maker.publicKey, true, true),
            key(TOKEN_PROGRAM_ID),
            key(SystemProgram.programId),
            key(SYSVAR_RENT_PUBKEY),
          ],
          offerBytes(p),
        ),
      );
      signers.push(market, maker);
    } else {
      if (!p)
        throw new ApiError(404, 'POSITION_NOT_FOUND', 'Position not found.');
      if (
        p.holder !== holder.publicKey.toBase58() ||
        p.maker !== maker.publicKey.toBase58() ||
        p.mint !== mint.toBase58() ||
        p.programId !== this.program.toBase58()
      )
        throw new ApiError(
          409,
          'IDENTITY_MISMATCH',
          'The contract belongs to a different chain configuration.',
        );
      const o = p.offer,
        v = p.vault,
        m = p.market;
      if (action === 'accept') {
        ixs.push(
          ix(
            'accept_offer',
            [
              key(o, true),
              key(mint),
              key(v),
              key(holderCash, true),
              key(makerCash, true),
              key(holder.publicKey, false, true),
              key(maker.publicKey),
              key(TOKEN_PROGRAM_ID),
            ],
            offerBytes(p),
          ),
        );
        signers.push(holder);
      } else if (action === 'cancel') {
        ixs.push(
          ix('cancel_offer', [
            key(o, true),
            key(mint),
            key(v, true),
            key(makerCash, true),
            key(maker.publicKey, false, true),
            key(TOKEN_PROGRAM_ID),
          ]),
        );
        signers.push(maker);
      } else if (action === 'settle') {
        if (!input.missing)
          ixs.push(
            ix(
              'publish_observation',
              [key(m, true), key(authority.publicKey, false, true)],
              Buffer.concat([feed, i64(p.historicalAt), Buffer.from([0, 0])]),
            ),
          );
        ixs.push(ix('settle', [key(o, true), key(m)]));
      } else {
        const who = action === 'claim-holder' ? holder : maker,
          cash = action === 'claim-holder' ? holderCash : makerCash;
        ixs.push(
          ix('claim', [
            key(o, true),
            key(mint),
            key(v, true),
            key(cash, true),
            key(who.publicKey, false, true),
            key(TOKEN_PROGRAM_ID),
          ]),
        );
        signers.push(who);
      }
    }
    const latest = await this.connection.getLatestBlockhash();
    const tr = new Transaction({
      feePayer: authority.publicKey,
      ...latest,
    }).add(...ixs);
    tr.sign(...signers);
    const simulationTx = new VersionedTransaction(tr.compileMessage());
    simulationTx.sign(signers);
    const simulation = await this.connection.simulateTransaction(simulationTx, {
      sigVerify: true,
      commitment: 'confirmed',
    });
    if (simulation.value.err)
      console.error(
        'Chain preflight rejected',
        simulation.value.err,
        simulation.value.logs,
      );
    if (simulation.value.err)
      throw new ApiError(
        409,
        'CHAIN_REJECTED',
        friendlyChainError({
          message: JSON.stringify(simulation.value.err),
          logs: simulation.value.logs || [],
        }),
      );
    return {
      position: p,
      signature: base58(tr.signature!),
      raw: tr.serialize().toString('base64'),
      lastValidHeight: latest.lastValidBlockHeight,
    };
  }
  async broadcast(raw: string) {
    await this.connection.sendRawTransaction(Buffer.from(raw, 'base64'), {
      skipPreflight: false,
      maxRetries: 2,
      preflightCommitment: 'confirmed',
    });
  }
  async confirmation(signature: string, height: number) {
    const result = (
      await this.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (
      result?.confirmationStatus === 'confirmed' ||
      result?.confirmationStatus === 'finalized'
    )
      return result.err ? { error: JSON.stringify(result.err) } : 'confirmed';
    if (!result && (await this.connection.getBlockHeight('finalized')) > height)
      return 'expired';
    return 'pending';
  }
  async read(p: ChainPosition) {
    const response = await this.connection.getMultipleAccountsInfoAndContext(
      [pk(p.offer), pk(p.vault), SYSVAR_CLOCK_PUBKEY],
      'confirmed',
    );
    const [account, vaultInfo, clock] = response.value;
    if (!clock || clock.data.length < 40)
      throw Error('Solana clock is unavailable.');
    const vault = unpackAccount(pk(p.vault), vaultInfo);
    const slot = response.context.slot;
    if (
      !account ||
      !account.owner.equals(this.program) ||
      account.data.length < 244
    )
      throw new ApiError(
        503,
        'CHAIN_STATE',
        'The contract account is unavailable or invalid.',
      );
    const status = (
      ['funded', 'active', 'awaiting', 'settled', 'cancelled'] as const
    )[account.data[233]];
    if (!status) throw Error('Unknown on-chain state.');
    return {
      ...p,
      status:
        account.data[242] && account.data[243] ? ('closed' as const) : status,
      buyerPayout: Number(account.data.readBigUInt64LE(234)) / 1e6,
      buyerClaimed: !!account.data[242],
      makerClaimed: !!account.data[243],
      escrow: Number(vault.amount) / 1e6,
      lastSlot: slot,
      chainTime: Number(clock.data.readBigInt64LE(32)),
      updatedAt: new Date().toISOString(),
      pending: false,
      warning: undefined,
    };
  }
  async proof(signature: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
      throw new ApiError(400, 'SIGNATURE', 'Invalid transaction signature.');
    const t = await this.connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!t)
      throw new ApiError(
        404,
        'PROOF_UNAVAILABLE',
        'Transaction proof is not currently available.',
      );
    return {
      network: this.config.network,
      signature,
      slot: t.slot,
      blockTime: t.blockTime,
      error: t.meta?.err,
      logs: t.meta?.logMessages,
      preTokenBalances: t.meta?.preTokenBalances,
      postTokenBalances: t.meta?.postTokenBalances,
      verifiedAt: new Date().toISOString(),
    };
  }
}
