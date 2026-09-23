import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  Connection,
  VersionedTransaction,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
export const PROGRAM = new PublicKey(
  '3VpPpDGYjxawotjb6xMYdUsZoazszT7NLb1wgVod9Xcm',
);
const store = process.env.STRATA_STATE_DIR || '/var/lib/stocklana';
const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const c = new Connection(rpc, 'confirmed');
const chainClock = async () => {
  const account = await c.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!account || account.data.length < 40)
    throw Error('Solana clock is unavailable.');
  return Number(account.data.readBigInt64LE(32));
};
const pk = (v) => new PublicKey(v);
const u64 = (x) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(x));
  return b;
};
const i64 = (x) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(x));
  return b;
};
const hash = (x) => crypto.createHash('sha256').update(x).digest();
const key = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey: pk(pubkey),
  isWritable,
  isSigner,
});
const instruction = (name, keys, body = Buffer.alloc(0)) =>
  new TransactionInstruction({
    programId: PROGRAM,
    keys,
    data: Buffer.concat([hash(`global:${name}`).subarray(0, 8), body]),
  });
export const offerBytes = (t) =>
  Buffer.concat([
    u64(t.nonce),
    t.taker.toBuffer(),
    Buffer.from([t.kind]),
    u64(t.low),
    u64(t.high),
    u64(t.quantity),
    u64(t.premium),
    i64(t.expiry),
    i64(t.deadline),
  ]);
async function readKey(name) {
  const file = `${store}/${name}.json`;
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await fs.readFile(file, 'utf8'))),
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const k = Keypair.generate();
    await fs.writeFile(file, JSON.stringify([...k.secretKey]), { mode: 0o600 });
    return k;
  }
}
export async function runVerification() {
  const deployer = await readKey('deployer'),
    holder = await readKey('holder'),
    maker = await readKey('maker');
  const network = process.env.SOLANA_NETWORK || 'localnet';
  if (!['localnet', 'devnet'].includes(network))
    throw Error('Only explicit test networks are supported.');
  if (
    network === 'localnet' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpc).hostname)
  )
    throw Error('Localnet RPC must be loopback.');
  const genesis = await c.getGenesisHash();
  if (network === 'devnet' && genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
    throw Error('Devnet genesis mismatch.');
  if (
    !process.env.SOLANA_GENESIS_HASH ||
    genesis !== process.env.SOLANA_GENESIS_HASH ||
    genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
  )
    throw Error('Explicit test-network genesis pin required.');
  const transactions = [],
    checks = [];
  const tx = async (label, ixs, signers = [deployer]) => {
    const t = new Transaction().add(...ixs);
    t.feePayer = deployer.publicKey;
    const uniq = [
      ...new Map(
        [deployer, ...signers].map((s) => [s.publicKey.toBase58(), s]),
      ).values(),
    ];
    const signature = await sendAndConfirmTransaction(c, t, uniq, {
      commitment: 'confirmed',
      maxRetries: 4,
    });
    transactions.push({
      label,
      signature,
      slot:
        (
          await c.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          })
        )?.slot ?? null,
    });
    await transactionProof(signature);
    process.stdout.write(`${label}: ${signature}\n`);
    return signature;
  };
  const deployed = await c.getAccountInfo(PROGRAM);
  if (!deployed?.executable)
    throw Error(`Strata program is not deployed on ${network}.`);
  const balance = await c.getBalance(deployer.publicKey);
  if (balance < 50_000_000)
    throw Error(
      'The dedicated devnet demo wallet needs test SOL from the Solana faucet.',
    );
  let mint;
  try {
    mint = pk(
      JSON.parse(await fs.readFile(`${store}/${network}-mint.json`, 'utf8'))
        .mint,
    );
    await getAccount(
      c,
      (
        await getOrCreateAssociatedTokenAccount(
          c,
          deployer,
          mint,
          maker.publicKey,
        )
      ).address,
    );
  } catch (e) {
    if (e.code !== 'ENOENT' && !String(e).includes('TokenAccountNotFound'))
      throw e;
    mint = await createMint(c, deployer, deployer.publicKey, null, 6);
    await fs.writeFile(
      `${store}/${network}-mint.json`,
      JSON.stringify({ mint: mint.toBase58() }),
    );
  }
  const holderCash = (
    await getOrCreateAssociatedTokenAccount(c, deployer, mint, holder.publicKey)
  ).address;
  const makerCash = (
    await getOrCreateAssociatedTokenAccount(c, deployer, mint, maker.publicKey)
  ).address;
  const mintSig = await mintTo(
    c,
    deployer,
    mint,
    makerCash,
    deployer,
    50_000_000_000n,
  );
  await transactionProof(mintSig);
  transactions.push({
    label: 'Mint demo maker capital (test USDC)',
    signature: mintSig,
  });
  const holderSig = await mintTo(
    c,
    deployer,
    mint,
    holderCash,
    deployer,
    10_000_000_000n,
  );
  await transactionProof(holderSig);
  transactions.push({
    label: 'Mint demo holder capital (test USDC)',
    signature: holderSig,
  });
  // Maker pays offer-account rent; keep all fee funding inside dedicated test wallets.
  if ((await c.getBalance(maker.publicKey)) < 50_000_000)
    await tx('Fund second test wallet rent', [
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: maker.publicKey,
        lamports: 50_000_000,
      }),
    ]);
  const history = JSON.parse(
    await fs.readFile(new URL('../data/history.json', import.meta.url), 'utf8'),
  );
  const feed = hash('NVDA/USD:historical-daily-close-v1');
  const dataset = Buffer.from(history.sha256, 'hex');
  const chainNow = await chainClock();
  const expiry = chainNow + 100;
  const scenarios = [
    {
      id: 'deepseek',
      date: '2025-01-27',
      kind: 0,
      low: 120,
      high: 140,
      premium: 400,
    },
    {
      id: 'earnings',
      date: '2025-02-27',
      kind: 0,
      low: 115,
      high: 130,
      premium: 350,
    },
    {
      id: 'rebound',
      date: '2025-01-22',
      kind: 1,
      low: 130,
      high: 145,
      premium: 500,
    },
  ];
  const runs = [];
  const acceptIx = (
    r,
    taker = holder.publicKey,
    t = r.terms,
    tokenProgram = TOKEN_PROGRAM_ID,
    mintArg = mint,
  ) =>
    instruction(
      'accept_offer',
      [
        key(r.offer, true),
        key(mintArg),
        key(r.vault),
        key(holderCash, true),
        key(makerCash, true),
        key(taker, false, true),
        key(maker.publicKey),
        key(tokenProgram),
      ],
      offerBytes(t),
    );
  const cancelIx = (r) =>
    instruction('cancel_offer', [
      key(r.offer, true),
      key(mint),
      key(r.vault, true),
      key(makerCash, true),
      key(maker.publicKey, false, true),
      key(TOKEN_PROGRAM_ID),
    ]);
  const settleIx = (r, market = r.market.publicKey) =>
    instruction('settle', [key(r.offer, true), key(market)]);
  const claimIx = (r, who) =>
    instruction('claim', [
      key(r.offer, true),
      key(mint),
      key(r.vault, true),
      key(who === holder ? holderCash : makerCash, true),
      key(who.publicKey, false, true),
      key(TOKEN_PROGRAM_ID),
    ]);
  const snapshot = async (r) => {
    const [o, v, h, m] = await Promise.all([
      c.getAccountInfo(r.offer),
      getAccount(c, r.vault),
      getAccount(c, holderCash),
      getAccount(c, makerCash),
    ]);
    return {
      offer: o.data.toString('hex'),
      vault: v.amount.toString(),
      holder: h.amount.toString(),
      maker: m.amount.toString(),
    };
  };
  const reject = async (name, r, ix, signers = [holder]) => {
    const before = await snapshot(r);
    let failed = false;
    try {
      const t = new Transaction().add(ix);
      t.feePayer = deployer.publicKey;
      t.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
      t.sign(deployer, ...signers);
      const result = await c.simulateTransaction(
        new VersionedTransaction(t.compileMessage()),
      );
      failed = !!result.value.err;
    } catch {
      failed = true;
    }
    if (!failed) throw Error(`${name}: invalid transaction was accepted`);
    const after = await snapshot(r);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw Error(`${name}: state changed`);
    checks.push(name);
  };
  for (const [i, s] of scenarios.entries()) {
    const market = Keypair.generate();
    const price = history.rows.find((r) => r.date === s.date).close;
    const historicalAt = Math.floor(
      new Date(`${s.date}T21:00:00Z`).getTime() / 1000,
    );
    await tx(
      `${s.id}: commit historical observation`,
      [
        instruction(
          'create_market',
          [
            key(market.publicKey, true, true),
            key(deployer.publicKey, true, true),
            key(mint),
            key(SystemProgram.programId),
          ],
          Buffer.concat([
            feed,
            dataset,
            u64(Math.round(price * 1e6)),
            i64(historicalAt),
            i64(expiry),
          ]),
        ),
      ],
      [market],
    );
    const nonce = BigInt(Date.now()) * 100n + BigInt(i);
    const [offer] = PublicKey.findProgramAddressSync(
      [Buffer.from('offer'), maker.publicKey.toBuffer(), u64(nonce)],
      PROGRAM,
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), offer.toBuffer()],
      PROGRAM,
    );
    const terms = {
      nonce,
      taker: holder.publicKey,
      kind: s.kind,
      low: s.low * 1e6,
      high: s.high * 1e6,
      quantity: 100e6,
      premium: s.premium * 1e6,
      expiry,
      deadline: expiry - 10,
    };
    const r = { ...s, market, price, historicalAt, offer, vault, terms };
    const fund = instruction(
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
      offerBytes(terms),
    );
    await tx(`${s.id}: maker reserves full payout`, [fund], [maker]);
    if (
      (await getAccount(c, vault)).amount !== BigInt((s.high - s.low) * 100e6)
    )
      throw Error('Wrong funded reserve');
    checks.push(`${s.id}: full escrow`);
    if (i === 0) {
      await reject(
        'Altered terms rejected without state changes',
        r,
        acceptIx(r, holder.publicKey, { ...terms, premium: terms.premium + 1 }),
      );
      await reject('Wrong signer rejected', r, acceptIx(r, maker.publicKey), [
        maker,
      ]);
      await reject(
        'Wrong token program rejected',
        r,
        acceptIx(r, holder.publicKey, terms, SystemProgram.programId),
      );
      await reject(
        'Substituted mint rejected',
        r,
        acceptIx(r, holder.publicKey, terms, undefined, PROGRAM),
      );
      await reject('Nonce reuse rejected', r, fund, [maker]);
    }
    await tx(`${s.id}: holder accepts exact terms`, [acceptIx(r)], [holder]);
    if (i === 0) {
      await reject('Repeated acceptance rejected', r, acceptIx(r));
      await reject('Cancellation after acceptance rejected', r, cancelIx(r), [
        maker,
      ]);
      await reject('Premature settlement rejected', r, settleIx(r), []);
    }
    runs.push(r);
  }
  const wait = Math.max(0, expiry - (await chainClock()) + 2);
  process.stdout.write(
    `Waiting ${wait}s for committed replay observation time\n`,
  );
  let observed = await chainClock();
  for (let attempts = 0; observed < expiry && attempts < 300; attempts++) {
    await new Promise((r) => setTimeout(r, 1000));
    observed = await chainClock();
  }
  if (observed < expiry) throw Error('Solana clock did not reach expiry.');
  for (const [i, r] of runs.entries()) {
    if (i === 0) {
      await tx('Missing observation: await data, reserve stays locked', [
        settleIx(r),
      ]);
      const a = await c.getAccountInfo(r.offer);
      if (a.data[233] !== 2) throw Error('Missing-data state did not persist');
      checks.push('Missing data locks reserve');
      const badPub = instruction(
        'publish_observation',
        [key(r.market.publicKey, true), key(deployer.publicKey, false, true)],
        Buffer.concat([
          Buffer.alloc(32),
          i64(r.historicalAt),
          Buffer.from([0, 0]),
        ]),
      );
      await reject('Wrong feed rejected', r, badPub, []);
      const uncertain = instruction(
        'publish_observation',
        [key(r.market.publicKey, true), key(deployer.publicKey, false, true)],
        Buffer.concat([feed, i64(r.historicalAt), Buffer.from([51, 0])]),
      );
      await reject('Excessive confidence interval rejected', r, uncertain, []);
    }
    await tx(`${r.id}: publish committed sample`, [
      instruction(
        'publish_observation',
        [key(r.market.publicKey, true), key(deployer.publicKey, false, true)],
        Buffer.concat([feed, i64(r.historicalAt), Buffer.from([0, 0])]),
      ),
    ]);
    await tx(`${r.id}: settle fixed entitlements`, [settleIx(r)]);
    const intrinsic =
      r.kind === 0
        ? Math.max(0, Math.min(r.high - r.low, r.high - r.price))
        : Math.max(0, Math.min(r.high - r.low, r.price - r.low));
    const expected = BigInt(Math.round(intrinsic * 100 * 1e6));
    const info = await c.getAccountInfo(r.offer);
    const actual = info.data.readBigUInt64LE(234);
    if (actual !== expected)
      throw Error(
        `Payout mismatch ${actual.toString()} != ${expected.toString()}`,
      );
    if (i === 0) {
      const before = await snapshot(r);
      await tx('Idempotent keeper retry', [settleIx(r)]);
      if (JSON.stringify(before) !== JSON.stringify(await snapshot(r)))
        throw Error('Repeated settlement changed state');
      checks.push('Settlement is idempotent');
      await reject(
        'Wrong settlement market rejected',
        r,
        settleIx(r, runs[1].market.publicKey),
        [],
      );
    }
    const hb = (await getAccount(c, holderCash)).amount,
      mb = (await getAccount(c, makerCash)).amount;
    await tx(`${r.id}: holder claims payout`, [claimIx(r, holder)], [holder]);
    await tx(`${r.id}: maker claims remainder`, [claimIx(r, maker)], [maker]);
    if ((await getAccount(c, vaultOf(r))).amount !== 0n)
      throw Error('Escrow did not empty');
    const ha = (await getAccount(c, holderCash)).amount,
      ma = (await getAccount(c, makerCash)).amount;
    if (
      ha - hb !== expected ||
      ha - hb + ma - mb !== BigInt((r.high - r.low) * 100e6)
    )
      throw Error('Claims do not conserve collateral');
    checks.push(`${r.id}: payout ${Number(expected) / 1e6} and conservation`);
    if (i === 0) await reject('Double claim rejected', r, claimIx(r, holder));
  }
  const result = {
    network,
    programId: PROGRAM.toBase58(),
    mint: mint.toBase58(),
    holder: holder.publicKey.toBase58(),
    maker: maker.publicKey.toBase58(),
    dataset: history.sha256,
    completedAt: new Date().toISOString(),
    transactions,
    checks,
    scenarios: runs.map((r) => ({
      id: r.id,
      date: r.date,
      price: r.price,
      offer: r.offer.toBase58(),
      market: r.market.publicKey.toBase58(),
      vault: r.vault.toBase58(),
      reserve: (r.high - r.low) * 100,
      payout:
        (r.kind === 0
          ? Math.max(0, Math.min(r.high - r.low, r.high - r.price))
          : Math.max(0, Math.min(r.high - r.low, r.price - r.low))) * 100,
    })),
  };
  await fs.writeFile(
    `${store}/evidence.json.tmp`,
    JSON.stringify(result, null, 2),
  );
  await fs.rename(`${store}/evidence.json.tmp`, `${store}/evidence.json`);
  return result;
}
function vaultOf(r) {
  return r.vault;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  runVerification()
    .then((r) =>
      process.stdout.write(
        JSON.stringify({
          network: r.network,
          checks: r.checks,
          transactions: r.transactions.length,
        }) + '\n',
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}

export async function transactionProof(signature) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
    throw Error('Invalid signature');
  const dir = `${store}/proofs`;
  await fs.mkdir(dir, { recursive: true });
  const file = `${dir}/${signature}.json`;
  const t = await c.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!t) {
    try {
      return { ...JSON.parse(await fs.readFile(file, 'utf8')), archived: true };
    } catch {
      throw Error('Transaction unavailable');
    }
  }
  const result = {
    network: process.env.SOLANA_NETWORK || 'localnet',
    signature,
    slot: t.slot,
    blockTime: t.blockTime,
    error: t.meta?.err,
    logs: t.meta?.logMessages,
    preTokenBalances: t.meta?.preTokenBalances,
    postTokenBalances: t.meta?.postTokenBalances,
    verifiedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, JSON.stringify(result));
  return result;
}
