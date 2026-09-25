# Parcel program execution

`programs/parcel` implements the current product. `programs/strata` remains the original spread escrow and is unchanged. The Parcel build was deployed additively to the existing private validator without resetting its ledger or changing the running app.

## V2 compatibility

The product-suite program adds optional curve terms and hourly clock observations; instruction names are `initialize_v2` / `execute_v2`, and signer derivation retains the fixed version-two domain used by the deployed accounts. Configure this separate deployment with a fresh state directory. The prior V1 program and its active accounts remain intact; no account migration, pending-operation conversion or in-place reinterpretation is supported. The always-on application has not been promoted by this task.

It runs as `GmWcUUpydUumJ5eSaXzN7SVryLjD6vvaJMDtj3W3Wcbx` on the pinned private validator, where it is deployed and confirmed. Its first devnet identity was `A4NTJ45BZT951nYh5xDXUKtyWij3YrYjcngyMigsq9pG`, **deployed on 2026-09-19** (deploy signature `HF7b9nY6dSqMxV3GHSFjdT2LsjkKDDC3wwyJ2Tb8YTJAHe1w21bR7ygcaZqucNFVRydGSxuamheyf6yRXxoTAqE`) with test mints `5wbtrHgkfssqreoTkyQKwgrUWqyV85otjgNkdEoAiETr` (cash) and `HWhEjmFRxXFQPDV6NPcxaX1zbeiRxWP2qAvJ5ud3vC3z` (stock), both six decimals under that operator. The complete 19-action lifecycle and all 14 adversarial rejections have since been **confirmed on devnet**, against a dedicated RPC endpoint; see "Rate limits" below for why the public one will not do. That deployment is now stranded: its operator key was lost with `trading-01` on 2026-09-23, and the operator is compiled into the program. Devnet is redeployed as `FwEY5cM9vP31LwywoJu1XWQ1nvBeNh2aMsVVpbYayRvC` under its own operator `7K12outW8HdaD7McqqGD2nTJW55nd7eYeqxMLVZZiQtS`; see `ops/README.md`. These are independently keyed programs, not one program on two ledgers: `declare_id!` is compiled in, so the devnet artifact is built with `--features devnet` and is a different binary. The private validator's program keeps the id its recorded audit evidence was produced under, and its deployment key is not held, so it can no longer be upgraded and stands as frozen evidence. A vault book is pinned to the ledger that produced it, and no book is migrated between them.

## Operator configuration

Set `PARCEL_CHAIN_ENABLED=true`, `PARCEL_PROGRAM_ID`, `PARCEL_CASH_MINT`, and `PARCEL_STOCK_MINT`, alongside the existing `CHAIN_ENABLED=true`, an RPC and an exact `SOLANA_GENESIS_HASH` pin.

Two targets are accepted, both no-value test ledgers: the pinned private validator (`SOLANA_NETWORK=localnet`, loopback RPC) and the public test cluster (`SOLANA_NETWORK=devnet`, an HTTPS RPC, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`). **Mainnet is refused by the genesis pin itself and cannot be configured on either.** The pin is required whenever chain execution is enabled, so a misconfigured deployment fails at boot rather than on a user's first contract.

The pin is what makes the target real rather than declared. `SOLANA_NETWORK` states only which cluster the operator meant; the pin states which ledger they actually provisioned. A devnet mode whose pin is not devnet's own genesis is refused as a misconfiguration, and a localnet mode never silently accepts devnet. Leaving Parcel chain mode unset starts the explicit sandbox; an enabled but unavailable chain never falls back to offchain execution.

The dedicated operator key stays at `STRATA_STATE_DIR/deployer.json` on the VPS. Both test mints have six decimals and that operator as mint authority. Session-specific owner and vault-account keys are derived using a domain-separated HMAC. These are service-held **test signers**, not user wallet authentication or self custody. Every program mutation requires both owner and operator signatures.

Fresh localnet sessions provision wallet test capital and actual PDA-controlled SPL escrow. Existing sandbox books are not silently imported: a nonzero sandbox revision without matching onchain state is rejected. Use a fresh browser session for the isolated review environment. Migration `003-vault-chain.sql` is additive and leaves deployed historical data intact.

## Execution and recovery

1. Validate intent, revision and quote. Derive a complete candidate book without committing balances or consuming the quote.
2. Durably save the plan and original request key. One unresolved operation per session is enforced by a database index.
3. Prepare and simulate the program transaction; save signed bytes, signature and block-height validity before broadcast.
4. The program derives the new book, checks reserve/conservation and SPL backing, compares its computed economic hash with the expected projection, and increments its revision.
5. Reconcile the original signature, then compare the program account with the expected book. Only then commit the SQLite index, quote consumption and receipt together.

Lost sends or verification responses retain the original signed transaction. A restart resumes it. A known program failure or finalized transaction expiry is recorded as failed (signed bytes kept for forensics); a transient RPC failure remains pending. A second intent cannot replace an unresolved operation.

Open premiums for bounded claims and curves are clamped in TypeScript (`clampExecutablePremium`) to the same cash envelope `Action::Open` enforces on-chain, so a live modelled ask cannot exceed max payable value and then fail simulation. Naked options stay unconstrained. Close is not envelope-checked on-chain.

Program positions are active economic obligations; closed history and readable event descriptions remain in the index. A vault supports 64 active positions. Account allocation is 64 KiB; the transaction requests 1.4 million compute units and a 256 KiB heap, and the program allocator uses that requested frame. The earlier V1 64-contract fixture consumed approximately 538,000 units when opening the final contract and 111,000 when settling the group; current nonlinear capacity measurements are recorded separately in the product-suite audit. Cash collateral uses the same analytic integer strike envelope as the TypeScript engine. The historical price and dividend observations are compiled into the program, not supplied by a browser. Test premiums are authorized by the operator, not claimed as external oracle prices.

## Reproduce

Use the installed VPS Rust/Agave paths documented in `ops/README.md`. The shared validator enables SBPFv3 and disables new v0/v1/v2 deployments:

```sh
cd programs/parcel
cargo test --lib
cargo build-sbf --arch v3
```

The program ID is declared in source. Keep its deployment key only on the VPS. Do not reset the shared validator. For a new isolated environment, change the declared test operator and program ID deliberately, rebuild and provision corresponding no-value mints.

With the environment configured, run `npm run verify:parcel-chain` and `npm run verify:parcel-adversarial`. The first verifies a complete lifecycle plus actual SPL escrow balances; the second constructs signed invalid transactions and checks the program's own rejection. Prior evidence is under `docs/audit/2026-09-15-release/`; current evidence is under `docs/audit/2026-09-15-product-suite/`. Run `npm run verify:parcel-suite` for the extended lifecycle and `npm run verify:parcel-suite -- --capacity` for nonlinear capacity.

## Production boundaries

The operator can price quotes, provision test capital and upgrade this test program. Historical market advancement is a user-controlled replay, not a real-time expiry clock. The program does not implement issuer restrictions, corporate actions, live oracle attestations, user-owned wallet signing or independent liquidity. Donations to escrow are not accounted as user deposits. No production or permissionless custody claim is made.

## Devnet

Devnet is the public test cluster: no-value SOL, a real ledger anyone can read, and an explorer link a reviewer can open. It runs the same program, the same operator-held test signers and the same fail-closed rules as the private validator. It is not a production deployment and makes no custody claim.

Provision it from any machine with the Agave 4.3 CLI, Rust and the devnet keys (`~/.parcel-devnet/keys`):

```sh
cd programs/parcel
cargo build-sbf --tools-version v1.51.1 --arch v3 --features devnet
cp target/deploy/parcel.so ../../artifacts/parcel-devnet.so && cd ../..
KEYS=~/.parcel-devnet/keys STATE=~/.parcel-devnet/state RPC=<dedicated devnet https url> bash ops/deploy-devnet.sh
```

Build with platform-tools **v1.51.1**, the SBPFv3 compatibility release: devnet now runs the revised SBPFv3 feature (SIMD-0377), and a plain v1.51 binary fails the loader's header check. v1.52 and later dropped the SBPFv3 target altogether. v1.51.1 is Rust 1.84, so `programs/parcel/Cargo.toml` declares `rust-version = "1.84"` and the lockfile holds dependencies that build with it; resolve any lockfile update with `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback`. Deploy with the Agave 4.3 CLI: older CLIs do not know devnet's current SBPFv3 feature and refuse the program in their local pre-flight.

The script refuses to proceed unless the RPC's genesis really is devnet's, the artifact and both keys are present, and the deployer is the operator the program has compiled into it. It deploys the program, creates the two six-decimal no-value mints under that operator, seeds a **separate** devnet state directory, and prints the service environment. It never touches the private validator or its ledger. The devnet operator is its own key, compiled in under the `devnet` feature, and is never the validator's.

### Funding

Devnet SOL is a no-value faucet token, but it is rationed, and the balance is a running budget rather than a one-off cost.

The deploy itself holds **2.20 SOL** in the program account (the script sizes the program at 115% of the 377 KB binary rather than the loader's default of 200%, which would lock about 3.8 forever to buy upgrade headroom nobody asked for). A transient upload buffer of 1.91 is reclaimed on success, so the peak requirement is about **4.3 SOL**. These are devnet's rent figures; a default local test validator charges more, so size devnet funding against devnet.

After that, **every session that goes onchain allocates a 64 KiB vault account holding 0.3336 SOL of rent**. A public demo therefore spends about a third of a SOL per visitor, and a failed verification run costs the same, because it too opens a session. Budget the operator's balance against the number of sessions expected, and top it up from <https://faucet.solana.com> (GitHub sign-in) before a demo.

### Rate limits

`api.devnet.solana.com` is intended for light use and answers `429` within a handful of calls, which is not enough to complete a lifecycle run or to serve a desk to several readers at once. Point `SOLANA_RPC_URL` at a dedicated devnet endpoint — a free Helius or QuickNode tier is sufficient — before running the verification or demonstrating to anyone. The configuration already requires HTTPS for devnet, so such an endpoint drops straight in.

Two behaviours matter here and are easy to misread. The adapters keep the web3.js rate-limit retry **enabled on devnet and disabled on the private validator**, because a loopback validator answering `429` is a misconfiguration worth surfacing while a public cluster throttling is ordinary. And a throttled RPC is reported as the transport failure it is: only a genuinely absent mint reads as an unprovisioned ledger, so a `429` never sends an operator off to re-provision a ledger that is already correct.

## Durable mutation index

Every committed vault action writes three durable records in one SQLite transaction:

| Record | Role |
| --- | --- |
| `receipts` | Idempotent HTTP response for the original request key |
| `vault_mutations` | Queryable index: revision before/after, action type, quote id, execute premium, mode, event ids |
| `audit_events` | Compact audit line with type, revision, premium and optional chain signature |
| Book `events[]` | Human-readable activity feed shown in the desk |

Sandbox fills store `mode='sandbox'`. Confirmed Parcel program fills store `mode='localnet'` or `mode='devnet'` and also update `vault_chain_operations` (`action_type`, `signature`, `revision_after`, `proof`). Live-market settlement that occurs on read is recorded as `mode='system'` with a synthetic key; it is not an on-chain event.

Sandbox activity is **not** an on-chain record. Do not describe sandbox receipts, mutations or activity titles as localnet, devnet or mainnet evidence.

## Product coverage on the Parcel program

| Product | Pricing | On-chain status |
| --- | --- | --- |
| Options open/close | Black–Scholes mid via `orderGreeks` / `premium`; live market adds modelled bid/ask crossing (`tradedPremium`) | Encoded as `Open` / `Close` with the reviewed premium |
| Stock lending / recall | Protective call at 150% strike is Black–Scholes mid (`protectionPremium` / `premium`) | `Lend` / `Recall` |
| Protected short / cover | Protective call is Black–Scholes mid | `Short` / `Cover` |
| Cash borrow / repay | Pool utilisation APR (two-slope curve) — **not** Black–Scholes | `Borrow` / `Repay` (program stock mint / NVDA). Book layout includes `borrows`; requires a **fresh** ledger after upgrade |
| Spot transfer / stock | Mark / NBBO path | `Transfer` / `Stock` |

On-chain variable cash loans authorize and lock the APR at open (operator-signed). Sandbox variable loans still reprice each replay session from the pool curve.

## Live on-chain record: blockers on a bare workstation

A live Parcel program record needs all of the following. This repository's default `npm run demo` path is the explicit sandbox and does not require them.

1. **Agave / Solana CLI** (Agave 4.3 for current SBPFv3) — `solana`, `solana-test-validator`, and `cargo-build-sbf` on `PATH`.
2. **Platform tools v1.51.1** for SBPFv3 builds (`cargo build-sbf --tools-version v1.51.1 --arch v3`).
3. **Keys and state**
   - Localnet: operator key at `$STRATA_STATE_DIR/deployer.json`, program/mint config from `PARCEL_CHAIN.md` operator section, genesis pin from the running validator.
   - Devnet: keys only under `~/.parcel-devnet/keys` and state under `~/.parcel-devnet/state`. **Never delete or overwrite `~/.parcel-devnet`.** If that directory is missing, recreate it deliberately with new operator keys and redeploy; do not invent keys into a half-configured tree.
4. **RPC + genesis pin** — `PARCEL_CHAIN_ENABLED=true`, `CHAIN_ENABLED=true`, `PARCEL_PROGRAM_ID`, `PARCEL_CASH_MINT`, `PARCEL_STOCK_MINT`, `SOLANA_NETWORK`, `SOLANA_RPC_URL`, exact `SOLANA_GENESIS_HASH`. Mainnet genesis is refused.
5. **Fresh session** — nonzero sandbox revision without matching program state is rejected; use a new browser session after enabling chain mode.

When those are present, `npm run verify:parcel-chain` produces a real localnet lifecycle with SPL escrow balances, and `ops/deploy-devnet.sh` plus `npm run verify:parcel-chain` against a dedicated HTTPS RPC produce a public-test-cluster record. Prefer documenting and provisioning that path over installing a partial toolchain that cannot finish a build or deploy.
