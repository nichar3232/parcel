# Parcel program execution

`programs/parcel` implements the current product. `programs/strata` remains the original spread escrow and is unchanged. The Parcel build was deployed additively to the existing private validator without resetting its ledger or changing the running app.

## V2 compatibility

The product-suite program is `GmWcUUpydUumJ5eSaXzN7SVryLjD6vvaJMDtj3W3Wcbx` on the pinned private validator. It adds optional curve terms and hourly clock observations; instruction names are `initialize_v2` / `execute_v2`, and signer derivation retains the deployed `oddlot:v2` compatibility domain. Configure this separate deployment with a fresh state directory. The prior V1 program and its active accounts remain intact; no account migration, pending-operation conversion or in-place reinterpretation is supported. The always-on application has not been promoted by this task.

## Operator configuration

Set `PARCEL_CHAIN_ENABLED=true`, `PARCEL_PROGRAM_ID`, `PARCEL_CASH_MINT`, and `PARCEL_STOCK_MINT`, alongside the existing `CHAIN_ENABLED=true`, loopback RPC and exact `SOLANA_GENESIS_HASH` pin. Only private localnet is accepted for this release. Mainnet and devnet genesis hashes are refused. Leaving Parcel chain mode unset starts the explicit sandbox; an enabled but unavailable chain never falls back to offchain execution.

The dedicated operator key stays at `STRATA_STATE_DIR/deployer.json` on the VPS. Both test mints have six decimals and that operator as mint authority. Session-specific owner and vault-account keys are derived using a domain-separated HMAC. These are service-held **test signers**, not user wallet authentication or self custody. Every program mutation requires both owner and operator signatures.

Fresh localnet sessions provision wallet test capital and actual PDA-controlled SPL escrow. Existing sandbox books are not silently imported: a nonzero sandbox revision without matching onchain state is rejected. Use a fresh browser session for the isolated review environment. Migration `003-vault-chain.sql` is additive and leaves deployed historical data intact.

## Execution and recovery

1. Validate intent, revision and quote. Derive a complete candidate book without committing balances or consuming the quote.
2. Durably save the plan and original request key. One unresolved operation per session is enforced by a database index.
3. Prepare and simulate the program transaction; save signed bytes, signature and block-height validity before broadcast.
4. The program derives the new book, checks reserve/conservation and SPL backing, compares its computed economic hash with the expected projection, and increments its revision.
5. Reconcile the original signature, then compare the program account with the expected book. Only then commit the SQLite index, quote consumption and receipt together.

Lost sends or verification responses retain the original signed transaction. A restart resumes it. A known program failure or finalized transaction expiry is recorded as failed; a transient RPC failure remains pending. A second intent cannot replace an unresolved operation.

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
