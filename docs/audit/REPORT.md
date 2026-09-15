# Strata engineering audit

Audit performed September 14–15, 2026 against the actual project, historical dataset, deployed Anchor program, Node API and browser UI. This is implementation verification by the builder, not an independent security certification.

## Disposition

The first build was not an acceptable backend baseline. The primary portfolio was editable browser state, transaction persistence could lose a successful submission, session ownership was absent, and lint failed. Those paths have been replaced. The private VPS app now runs a transactional backend and a tested, modular frontend. The historical demo and actual Solana test-token lifecycle are operable.

The original design's **devnet gate remains open**: the dedicated authority still has zero devnet SOL and the latest faucet request failed. Current evidence is from an isolated validator. Public publication and the submission form are also pending. This report does not label localnet as devnet or call the project production-ready.

## Findings and remediation

| Finding | Impact | Final treatment and evidence |
|---|---|---|
| Browser-owned portfolio and editable balances | No authoritative accounting | SQLite ledger; only typed actions accepted; server prices/clock/IDs; full lifecycle and reload tests |
| Shared test wallets and unowned JSON sessions | Cross-user interference | Random HttpOnly session cookie, hashed token, owner-filtered SQL and session-specific HMAC-derived test wallets; foreign reads/mutations rejected |
| Signature recorded after confirmation | Lost success, duplicate funding after timeout | Signed bytes and signature committed before broadcast; same-key retries; process-store restart and dropped-response tests |
| Proof archival in the success path | An evidence error could masquerade as failed transfer | Confirmed status persisted first; archival failure test retains signature and success |
| Asynchronous request races | Stale updates and conflicting actions | SQL revisions, receipts, unique pending operation, per-session preparation lock, immutable inputs; stale-tab and concurrency tests |
| A late chain read overwrote newer evidence | Lost signatures / stale balances | One-context account reads, monotonic slots, latest transaction merge; delayed-read regression |
| Wall-clock settlement countdown | UI enabled an instruction before Solana time | Clock sysvar now returned with account state; active-contract polling; UI waits for chain time; clock-skew browser regression and live walkthrough |
| Constant new-wallet rent estimate | Atomic funding failed for new sessions | Validator-derived rent for maker, offer and token account; three actual scenarios fund successfully |
| Network inferred from RPC text | Wrong-network/mislabel risk | Explicit localnet/devnet + pinned genesis, mainnet rejection, mint authority/program checks |
| Unconditional health success | Deployment could appear healthy with broken execution | Separate liveness/readiness; ready requires database, RPC identity, executable program, mint and fee balance |
| Almost 3,000 lines of UI in one component | Fragile coupled UI and lint errors | 211-line shell, feature views/dialogs, separate API hooks, shared domain types; clean typecheck/lint |
| Divergent numerical validation | Fractional reserve mismatch | Shared bounded six-decimal validation; BigInt accounting and independent option-leg/codec tests |
| Unsafe native integer dependency | Known memory-safety advisory | Explicit bounded pure-JavaScript compatibility package; independent Node Buffer comparisons; no native addon loaded |
| Public long-running verification route | Interference and resource contention | Verification is now an operator CLI; no public verifier mutation endpoint |
| Stale demo/startup instructions | A fresh checkout did not provide the promised runtime | Correct start command, clean install, reproducible private release deploy, backup and rollback instructions; actual UI recording |

## Verified boundaries

- Portfolio: server-generated RFQs, validated scenarios, fixed historical settlement sample, exact base-unit movement, two-minute quote deadline, once-only claims and collateral conservation.
- API: bounded JSON, malformed input rejection, CSRF/origin checks, independent sessions, revision conflicts, identical retry responses, static GET/HEAD/ranges and explicit errors.
- Outbox: signatures exist before send; unknown RPC results stay pending; retries do not re-sign; merely processed errors are not treated as final; finalized expiration permits a new request.
- Program: wrong party, terms, mint, token program, market, nonce, feed, confidence and premature actions rejected; missing observations retain reserve; settlement is idempotent; duplicate claims fail; claims conserve reserves.
- UI: all seven views, desktop/mobile overflow checks, invalid form states, cancellation, settlement, missing data, both claims, reload, reconnect, stale tabs and a deliberately dropped response.
- Data: retained-source SHA-256 matches the normalized dataset and provenance. Import preserves the original retrieval time. Historical prices are actual provider closes; premiums and basis shocks remain labeled illustrations.

The network-time correction follows Solana's [Clock sysvar definition](https://docs.rs/solana-clock/latest/solana_clock/struct.Clock.html); wall time is not substituted for that value.

## Remaining dependency findings

`npm audit` reports **0 critical/high/low and 2 moderate entries**: `jayson` and its transitive `stream-json` parser, advisory [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x). Solana web3 imports `jayson/lib/client/browser`; that path uses JSON.parse/stringify and does not import the server streaming parser. A runtime module-load check confirmed zero loaded `stream-json` modules. The application does not expose Jayson's TCP/stream server API.

We retained that known, unreachable dependency finding rather than forcing an incompatible parser major into an unused upstream API. Recheck before exposing a new JSON-RPC streaming server or upgrading Solana SDKs. `vendor/bigint-buffer` is an original local compatibility replacement, explicitly documented and tested; its name/version must not be mistaken for an upstream release.

## Release limits

The trusted test oracle, current program deployment authority, retained account rent, lack of permanent-outage refunds, and lack of issuer/corporate-action integration remain deliberate limitations. Financing does not execute a loan. Session authentication protects an isolated no-value demo, not a real brokerage account. SQLite backups currently remain on the VPS; offsite disaster recovery is not provisioned. The environment is private and does not accept real collateral.

Measured commands and artifacts are listed in [submission/VALIDATION.md](../../submission/VALIDATION.md). Public submission requires at least one public GitHub, demo or video link under the [Stocklana rules](https://hackathons.solana.com/hackathons/stocklana); those publication actions have not been authorized/performed.

## Program artifact provenance

The current Rust source builds successfully. Changes to the original contract are formatting and removal of one unused import; normalized Rust token comparison confirms no logic change. `artifacts/strata.so` is the rebuilt artifact. `artifacts/strata-localnet.so` is a read-only dump of the executable used for the recorded tests. The existing validator preloaded that program with the system address as upgrade authority, so an attempted upgrade with the demo authority was rejected; the running program was not changed. We retain both artifacts and the original source, and do not claim byte identity between the rebuilt and deployed binaries. See `program-build.json` for hashes and the original-artifact comparison.
