# Validation — audited build

September 15, 2026. This report separates the working test environment from outstanding publication/devnet gates.

| Check | Result | Evidence |
|---|---|---|
| TypeScript | Clean | `npm run typecheck` |
| Lint | Clean, no rules disabled for application code | `npm run lint` |
| Domain/API/transport suite | 27 tests pass | `unit-test-results.txt` |
| Numerical properties | 10,000 independent option-leg samples, fractional base units and 64/128/256-bit codec boundaries | `tests/engine.test.ts`, `tests/integer-codec.test.ts` |
| Browser integration | 8 journeys: complete settlement/claims/reload, cancel/validation, stale tabs, reconnect, seven desktop/mobile views, missing data, dropped response, chain-clock skew | `browser-test-results.txt`, `docs/audit/screenshots/` |
| Anchor host tests | 3 pass | `docs/audit/rust-tests.txt` |
| SBF build and source provenance | Successful build; formatting-only source changes verified | `docs/audit/program-build.json`, both `artifacts/*.so` |
| Adversarial Solana verifier | 26 confirmed transactions; 20 checks | `chain-evidence.json`, `transaction-proofs/` |
| Actual backend + Solana | 16 confirmed transactions; three scenarios, ownership, request deduplication, missing data and exact claims | `backend-chain-evidence.json` |
| Actual UI + Solana | Recorded lifecycle, two claims and empty escrow | `ui-chain-evidence.json`, `strata-demo.mp4` |
| Persistence | Database/receipt restart and signed-outbox recovery tests; private service restart; online SQLite backup | backend tests and `docs/audit/deployment-checks.txt` |
| Dependency audit | 0 critical/high/low; 2 moderate entries in unused server parser | `docs/audit/npm-audit.json`, audit report |

## Worked economics

| Scenario | Reference close | Position | Premium | Holder payout |
|---|---:|---|---:|---:|
| DeepSeek | $118.42, Jan 27 | 100 × $120/$140 put spread | $400 | $2,000 |
| Earnings | $120.15, Feb 27 | 100 × $115/$130 put spread | $350 | $985 |
| Rebound, full size | $147.07, Jan 22 | 100 × $130/$145 call spread | $500 | $1,500 |
| Rebound, fractional API test | $147.07, Jan 22 | 0.333333 × $130/$145 call spread | $0.123456 | $4.999995 |

The normalized snapshot matches the retained provider response SHA-256 `dff80d1c6204a566087cc8570196078bffc4c73ef9215e7c6d3735a6807dfb13`. Its original retrieval timestamp is preserved during deterministic rebuilds.

## Program protections tested

Altered terms, wrong signer, wrong token program, substituted mint, nonce reuse, repeated acceptance, cancellation after acceptance, early settlement, wrong feed, excessive confidence, wrong settlement market and duplicate claims are rejected. Missing data preserves full escrow. Repeated settlement preserves fixed entitlements. Both claims distribute exactly the reserve.

The live recording also caught wall/chain-clock drift. The repaired UI uses the Clock sysvar from the same account observation, not an estimated wall-clock deadline. A browser regression deliberately puts wall time far ahead and verifies settlement remains disabled until chain time reaches expiry.

## Claims not made

This is **local-validator** evidence, not devnet or mainnet. The dedicated authority still has zero devnet SOL; the latest public airdrop attempt returned an RPC error. The design's devnet requirement is not marked complete. No live price-proof oracle, issuer integration, real lending execution, public publication, repository push or hackathon form submission is claimed.

`strata-demo.mp4` is an actual browser recording with narration. It shows the working backend practice ledger and separate real program escrow. Test capital and historical premiums are clearly labeled. The earlier generated explainer has been superseded.
