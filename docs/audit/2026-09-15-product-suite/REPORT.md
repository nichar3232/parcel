# Parcel product suite verification — 2026-09-15

The 0.4 product extension is implemented in the local source and verified through the same-origin Node/SQLite application and a separate private Solana validator program. The existing GitHub main branch, always-on app, V1 program/accounts, and previous video remain unchanged by this work. This report covers product mechanics and test-asset execution, not production brokerage readiness or external liquidity.

## Implemented scope

| Capability | Implementation and verification |
|---|---|
| Options chain | Eleven surrounding strikes, calls/puts, fractional quantity, expiry selection, model premiums and separate physical backing; selecting a row uses the existing funded quote workflow. Mobile strike cards keep funding and strike visible. |
| Basic / Advanced | Basic fixes template sides and ratios with editable strikes/quantity. Advanced enables leg composition, settlement and additional Greeks. Strategy choices are grouped by direction, volatility, convexity, dividends and cash flow. |
| Sizing | Share-equivalents, actual rounded premium budgets, and model dollar sensitivity per one-cent reference move. Exercise funding is displayed separately. A delayed sizing reply cannot overwrite edited terms. |
| Short expiries | Hourly test-clock expiries and daily sessions. Pricing and exact integer loan interest use elapsed time; each contract settles at its own committed expiry observation even when jumping several dates. Hourly ticks carry daily closes forward, without claiming historical intraday data. |
| Cross margin | Existing exact same-group bounds plus chronological cash-prefix reserves. Earlier guaranteed receipts may fund later liabilities; later receipts cannot fund earlier payments. No assumed correlation credit. Loan/short protection remains separately reserved. |
| Nonlinear products | Capped quadratic and exponential cash payoffs, up/down directions, buy/write sides. Frozen curve parameters in review, exact signed integer settlement, conservative bounds, identical opposite-curve offsets, priced closes. |
| Dividend structures | Call spreads, floor spreads, range butterflies and capped convexity on the committed dividend event, including underwriting. |
| Backend/program alignment | Shared transport contracts and existing durable quote/receipt recovery. Rust independently executes the same economic transitions and compares the serialized book with the backend projection before indexing. |

## Verification results

- `npm run check`: typecheck, lint, **76 application/domain/API tests**, and production frontend build pass.
- `npm run test:e2e`: **32 real-backend browser journeys** pass at desktop/mobile widths. This includes the existing recovery/ownership/collateral suite and new chain, sizing, curves, hourly settlement, dividend underwriting, mobile chain and delayed-sizing coverage.
- `cargo test --locked`: **8 native Rust tests** pass. SBPFv3 compilation passes.
- Product-suite private-validator lifecycle: **21 confirmed actions**, including calendar offsets, free-cash withdrawal, hourly curves, exact inverse offsets, hourly loans/shorts, dividends, a priced curve close and restart.
- Retained complete lifecycle on the V2 program: **19 confirmed actions**, ending with independently read SPL escrow balances of 4,000,000 test USDC and 20,000 test NVDA.
- Capacity: **64 distinct exponential contracts**, with upper boundaries immediately above the expiry price, all settle after all free cash is withdrawn. The final opening used **119,810 CU**, withdrawal **120,597 CU**, and multi-date settlement **902,560 CU**, within the requested 1,400,000 CU budget.
- **12 signed adversarial transactions** are rejected by the actual program: wrong owner/mint, stale revision, expired authorization, unfunded deposit, pledged-stock withdrawal, wrong projection, zero-payoff premium, excessive bounded premium, zero-payable curve, inverted curve boundaries and mixed physical/curve terms.
- Randomized independent price paths check that both parties remain solvent at every chronological cash-flow prefix. Nonlinear inverse rounding, capped tails, malformed inputs, budget limits and 500-position risk calculation bounds are covered.
- Final desktop/mobile screenshots were inspected. Routine tests now write to ignored `test-results/audit` instead of overwriting previous dated evidence.

## Issues found and resolved during this extension

The first 64-exponential settlement simulation exceeded the Solana compute ceiling. The implementation now caches the exact protocol exponential denominator, stops integer series evaluation after a zero term, and returns exact clipped-tail payouts directly. These are arithmetic-preserving changes; the harder near-cap fixture now settles within 903,000 CU. The test did not lower the promised position limit or substitute an offchain settlement.

Visual inspection found the wide chain hid strikes on narrow screens. The mobile layout now uses calls/puts tabs and cards displaying each strike, both execution sides and backing together. A legacy global label margin also added unnecessary form spacing; the Parcel field styles now explicitly own that spacing.

Two first-pass new browser assertions used exact cell names despite cells containing a contract ID. The executed contracts were present in the persisted table. Assertions were corrected to include those IDs without relaxing the economic checks.

## Program identity and compatibility

Program: `GmWcUUpydUumJ5eSaXzN7SVryLjD6vvaJMDtj3W3Wcbx`, private local validator only.

Compiled binary: 359,864 bytes. SHA-256: `8e8aab553f033d82c5b29e49f3da8cad550101e4f4289a19bff7b17551ffa36a`. The deployed program was dumped and matched byte-for-byte, apart from zero-filled allocation padding. `compute.json` and `deploy.json` record the corresponding evidence.

Terms serialization now includes an optional curve. V2 entrypoints and signer derivation are distinct from V1. The new program was deployed separately; old accounts, pending operations and the shared validator ledger were not migrated or reset. V1 accounts must remain with their V1 runtime. Existing vanilla SQLite books remain readable; the local app was restarted with the existing state directory so frontend and backend run the same version.

## Evidence and reproduction

`check.txt`, `browser.txt`, `native.txt`, `sbf.txt`, `compute.json`, `deploy.json`, the `parcel-*.json` transaction reports and the PNGs in this directory contain the verification record. See `docs/PRODUCT.md` for exact payoff/funding rules and `docs/PARCEL_CHAIN.md` for explicit private-validator setup. No private keys, session cookies, CSRF credentials, runtime databases or signed pending-operation payloads are included.

This extension does not connect external liquidity, live oracles, real issuer tokens or user wallet signing, and does not refresh the earlier submission video. Those boundaries follow the requested product-only scope.
