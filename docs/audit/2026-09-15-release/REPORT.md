# Oddlot release hardening — September 15, 2026

The reported accounting, rendering, confirmation and replay failures are corrected in the local release branch. Current Oddlot vault actions now have a matching Solana program and a recoverable backend integration, demonstrated with actual SPL test-token escrow on the private validator. This is a tested hackathon release candidate, not a production financial service or an independent security certification.

## Findings and resulting behavior

| Finding | Correction and evidence |
|---|---|
| Cross-collateral micro-unit shortfall | Sorted analytic integer extrema replace rounded price sampling. A contract-level truncation allowance protects the full group, capped by isolated reserve. Seeded independent integer sampling and a real historical settlement after withdrawing all free cash pass. The exact two-spread terms behind the reported 5.919327/5.919328 example were not supplied; that precise fixture is not claimed as reproduced. |
| Premium on a zero-payoff contract | Shared term validation rejects an entire payable obligation that rounds to zero. The program independently rejects it. Bounded premiums cannot exceed the contract's complete payable range. No premium, quote or position is recorded for rejected terms. |
| Seven-decimal rendering crash | Frontend validates before chart math; the API repeats validation. Browser tests cover 0.3333333, sub-unit precision and oversized strikes. |
| Empty vault reports zero exercise collateral | Quote projection is calculated independently of execution eligibility. An unfunded one-share $145 physical call reports $145 reserved cash plus its premium shortfall. |
| Covered-call chart omits stock loss | Covered call, protective put and collar charts include the selected stock quantity and reference entry. The exact $2.33 premium/$142.62 entry/$100 expiry fixture shows combined −$40.29. Delta includes stock where the chart does. |
| Incomplete or stale confirmations | Option reviews list every side, kind, strike, ratio, quantity, reference, settlement and expiry. Draft edits discard delayed quotes. The quote review counts down conservatively using monotonic time; revision and expiry remain server-enforced. |
| Close is confirmed before its price | Option close-outs obtain owner-bound expiring quotes. Short close and stock recall reviews show exact cash amounts and freeze the reviewed revision. |
| Interrupted browser intent may duplicate | Original request body/key persist before sending. Two lost responses, reload, blocked new action and same-key recovery are reproduced through the real API. The onchain coordinator also survives confirmed execution followed by interrupted indexing. |
| Last historical session has no reset | Final-date controls offer a new replay. Flat books restore test allocations while revision and receipts continue. |
| Slow collateral calculation | O(L log L) sorted strike sweeps replace quadratic grids. A 500-position/2,000-leg fixture measured 2.73 ms median and 4.88 ms p95 over 25 runs on this Mac; this is a fixture measurement, not a production SLA. |
| New products execute only in SQLite | `programs/oddlot` executes the current vault rules, checks collateral/conservation and actual SPL backing, and rejects a mismatched backend projection. SQLite commits only after confirmation and program-account verification. Sandbox mode remains explicitly separate. |
| Onchain larger books exhaust memory | The 64-position test found the default allocator still used 32 KiB despite a larger transaction heap request. The program now uses the bounded 256 KiB frame. A real 64-contract/256-leg book opens, withdraws all free cash and settles atomically. |
| Lending has no productive borrowing | New loans sell borrowed stock to the test market, buy covered cap protection and escrow repayment plus interest. Pledged market stock cannot be reused. Old stored loans retain their original repayment rules. |
| No real liquidity demonstrated | The product explicitly identifies funded test counterparties. No external maker, option demand or live borrow utilization is claimed. This is a remaining production integration, not something a simulator can establish. |
| Affordability claim hides funding | UI and entry distinguish fractional sizing from premium-only funding. The initial physical call requires approximately $145 exercise cash plus $4.04 premium. A cash-settled spread is a different bounded alternative. |
| Stale entry and video | Current entry, walkthrough, narration, video and UI evidence describe Oddlot. Prior Bellwether/Strata materials are archived under `submission/legacy/`. |

## Verification

- **65 application tests:** domain/API regressions, projection/commit boundaries, invalid intents, pending signatures, lost broadcasts and recovery after restart.
- **25 browser journeys:** actual same-origin backend, invalid inputs, covered downside, complete legs, close prices, final-date reset, stale tabs and lost-response/reload recovery; desktop and mobile view checks.
- **6 Rust tests:** integer fractional collateral sampling, exact offsets, physical strike boundaries, zero-payoff rejection and borrowing conservation.
- **19 confirmed lifecycle actions:** current program, including every vault action family; final actual SPL balances equal the initial pool allocation after reset.
- **9 adversarial program rejections:** independently signed wrong-owner/mint, revision, deadline, underfunding, pledged withdrawal, projection mismatch and invalid premium cases.
- **64 active four-leg contracts:** all free cash withdrawn, then all contracts settled successfully on the validator.
- Typecheck, lint, production build, repository hygiene and generated-source package checks.
- Current dependency audit: no high/critical findings; two moderate upstream entries remain (the inherited jayson/stream-json advisory).
- Separate actual-localnet UI check verifies the proof route, desktop/mobile layout and a definite HTTP 409 for an invalid withdrawal without creating a pending chain operation.

Evidence: [unit output](unit.txt), [browser output](browser.txt), [native tests](rust-test.txt), [lifecycle](chain-lifecycle.json), [adversarial tests](chain-adversarial.json), [capacity](chain-capacity.json), [performance](risk-performance.json), [deployed binary comparison](program-verification.json). The program binary in `artifacts/oddlot-localnet.so` matches the deployed program bytes. Raw current-program transactions are archived in `transaction-proofs/`.

## Organization and operating limits

The pure TypeScript ledger/risk layer remains separate from HTTP ownership and persistence. Shared funding functions keep reviewed short/loan amounts aligned with execution. `VaultService.plan` prepares without committing; `commit` records a verified result. `server/oddlot/chain` separates encoding, RPC/token preparation and durable orchestration. No RPC waits hold a SQLite write transaction. A database uniqueness constraint permits one unresolved operation per owner; raw signed bytes are stored before broadcasting.

The program stores active economic obligations; SQLite retains descriptions, closed history and receipts. Localnet supports 64 active positions, with explicit quote/action limits. Sandbox supports 500. Long-lived history/receipt retention is not yet paginated or pruned, and the service has no production rate-limiting/operational capacity claim. Session access uses the existing HttpOnly test cookie, not user wallet identity. Both test owner and operator signers are service-held. The operator prices test quotes and can upgrade the program. Issuer tokens, corporate actions, live oracle attestations, external liquidity and independent program review remain production work.

## Delivery status

Changes and the submission package are local. The review program was added to the private validator and exercised through an isolated temporary backend. The existing `stocklana-web` release, database and original validator ledger were not replaced or reset. No Git push, public publication or hackathon submission was performed. Judge access/public hosting remain publication steps requiring authorization under this repository's instructions.
