# Parcel frontend/backend follow-up audit

September 15, 2026. Baseline: `a3ea7d3a30eb537e457bc000a57831e611af5935`. This report accompanies local fixes; it is not evidence that those fixes have been pushed or deployed. The VPS was inspected read-only and still runs release `20260915T051923Z`.

## Verdict

The application has coherent, testable layers and real frontend/backend integration. It is not a collection of UI-only mock actions. However, the initial release verification missed meaningful edge cases. The unqualified implication that everything was sound was too strong. This audit reproduced defects, corrected them locally, and added regression coverage.

The reviewed product remains a private test-asset workspace. It is not ready for real funds or public multi-user operation. The retained `/legacy` Solana escrow program is separate from the new offchain vault rules; this follow-up did not constitute another independent program/security audit or mainnet verification.

## Findings and fixes

| ID | Priority | Finding in the shipped baseline | Local correction and evidence |
|---|---|---|---|
| A1 | P1 — accounting | Cross cash collateral sampled strike boundaries but missed per-contract rounding between boundaries. Three fractional puts could require one more cash base unit than reserved. A fully withdrawn account could fail expiry. | Reserve a conservative rounding allowance for unmatched fractional cash functions, capped at total isolated reserves. Exact opposing functions still cancel. Added an independent integer oracle over 20,000 mixed-portfolio observations, removed the old one-unit test tolerance, and reproduced settlement at an actual stored close. |
| A2 | P1 — transaction recovery | After both mutation responses were lost, the controller discarded the original key. A user retry/reload could create a new deposit after the first had already committed. An unreadable HTTP 200 response was also treated as definitive failure. | Persist the original intent/key in tab session storage before sending. Treat transport failures, unreadable responses and 5xx responses as ambiguous. Block new mutations until **Resolve saved action** completes with the original key. Browser tests prove one deposit after two lost responses, reload, attempted new action and recovery. |
| A3 | P2 — UI availability | Seven-decimal quantities and extreme strikes passed the view's shallow checks. The payoff chart then threw while converting input to base units; the trading workspace disappeared. | Extracted shared term validation and applied it before chart math and at the API boundary. Browser tests reject `0.0000001`, `0.3333333`, quantities above 1,000 and extreme strikes without losing the view; valid input recovers immediately. |
| A4 | P2 — review consistency | A delayed quote could reopen a review for an older draft. Stock/lending review values were derived from the latest live snapshot instead of a frozen review, so refresh could silently alter the displayed consideration before execution. | Discard quote responses after draft changes. Disable quotes whose vault revision changed. Freeze the stock/lending action, reference price and revision at review; require a new review after refresh. Browser tests exercise delayed quotes and a historical price change while a stock confirmation is open. |
| A5 | P2 — session consistency | The snapshot updater accepted any different CSRF identity, including a delayed action response from an older browser session. Retried requests read the current CSRF instead of preserving the original request identity. | Only the latest explicit session refresh may change account identity. Mutations capture their original identity/key/body, and old-account responses cannot replace the current vault. A browser test changes the session while a committed response is delayed. |
| A6 | P2 — static path boundary | Direct files were rooted, but the final `index.html` SPA fallback was not rechecked. A misconfigured index symlink could serve a file outside the public directory on an unknown route. | Resolve and root-check the final file, including fallbacks. HTTP regression checks both direct root and unknown-route requests against an outside symlink. No evidence of such a symlink on the VPS was found or implied. |
| A7 | P2 — error contract | `VaultService` converted SQLite infrastructure failures to a user-facing 409, exposing the database message and encouraging treatment as a definitive rule rejection. | Preserve SQLite failures as generic HTTP 500 responses. An injected receipt-write failure verifies atomic rollback of the book, revision, quote-consumed flag, audit entry and receipt; a later retry succeeds once. |

P1 means a core accounting or transaction invariant, not evidence of a real-money loss. All findings above are fixed in this local change. No vault state or keys were altered on the VPS.

### Concrete rounding reproduction

Open three cash-settled puts, each with quantity `0.020402`, expiring February 11, 2025:

| Side | Ratio | Strike |
|---|---:|---:|
| Buy | 2 | 150.165478 |
| Sell | 1 | 155.431558 |
| Sell | 1 | 156.349041 |

At the stored NVDA close of **132.80**, their separately truncated cash deliveries sum to **−0.233596 USDC**. The original envelope reserved **0.233595**. The corrected conservative reserve is **0.233597**. The regression opens all three through `VaultService`, withdraws all free cash, settles the historical expiry, and verifies one base unit remains and every asset is conserved. This is an actual action sequence, not a chart-only assertion.

## Code organization

The [module scan](module-boundaries.json) covered 58 TypeScript/TSX source files. It found **zero import cycles**, no Parcel view/controller imports of server or Node modules, and no server imports of UI/hooks. This is a static import scan, not a proof of every runtime property.

- `app/page.tsx` composes navigation and views.
- `components/parcel` owns forms, confirmations and presentation. It cannot replace ledger balances.
- `hooks/parcel/use-vault.ts` owns authoritative snapshots, mutation serialization, pending recovery and session freshness.
- `lib/client/api.ts` owns the shared HTTP contract; transport is no longer exported by the legacy portfolio hook.
- `lib/parcel/validation.ts` owns shared numeric and contract validation; server validation remains authoritative.
- `lib/parcel/math.ts` and `risk.ts` implement base-unit economics and collateral separately from React and database access.
- `server/parcel/service.ts` owns quotes, revisions, ownership and atomic action dispatch; `ledger.ts` owns transfers and settlement.
- `Store` owns SQLite transactions and durable receipts. No RPC call runs inside a vault write transaction.

The service dispatcher and feature views are still moderately sized modules. Splitting every branch into a class would add indirection without improving these boundaries. The accounting/recovery fixes and removal of cross-feature transport coupling address demonstrated problems rather than imposing a wholesale rewrite.

## Verification

| Check | Result / evidence |
|---|---|
| Typecheck, lint, production build | Pass; [check log](check.txt) |
| Domain, API, migration and persistence tests | **51 passed**; [unit log](unit.txt) |
| Real-backend browser journeys | **22 passed**; [browser log](browser.txt) |
| Baseline strategy price coverage | 12 templates × 2,001 prices; assertions now allow no one-unit shortfall |
| Added independent mixed-portfolio oracle | 100 seeded portfolios × 200 prices, exact integer comparisons |
| Actual HTTP routing | Session/CSRF/origin enforcement on both vault POST routes, body/media limits, ownership, forged settlement fields ignored, concurrent same-key and competing-revision requests |
| Transaction failure and reopen | Injected SQLite receipt failure rolls back all effects; close/reopen file-backed database returns the original successful receipt |
| Existing database upgrade | Real version-one SQLite file upgrades additively; retained portfolio/revision unchanged |
| Browser failure paths | Excess precision, delayed draft response, two lost responses + reload, unreadable success, old-session response, refreshed review |
| Visual inspection | Desktop/mobile journeys retained; inspected [invalid terms](invalid-terms.png) and [recovery banner](recovery.png) |
| Live VPS, read-only | Both units active, readiness healthy, database and `.env` mode 600, web restart policy/caps present; [service check](vps-service.txt) |
| Live saved books | SQLite integrity `ok`; **12 vaults checked, zero collateral failures** under corrected rules; [state check](vps-state-check.json) |
| Dependency audit | No critical/high advisories; two moderate dependency entries describe the same upstream issue; [npm audit](dependencies.json) |

Browser tests use the actual local HTTP server and SQLite database. Fault injection intercepts responses after backend commit; it does not substitute a fake successful ledger. No GitHub CI run is claimed for this unpushed audit change. The previously green remote workflow belongs to the shipped baseline.

## Remaining limitations

1. **History/receipt storage is not designed for unbounded use.** Events remain embedded in each serialized vault book, and action receipts retain snapshots. Repeated actions can grow storage faster than the event count. Sessions and receipts have no scheduled retention policy or endpoint rate limiting. The current live database is small (462,848 bytes, 135 receipts at inspection), but this is a P2 capacity concern before a public rollout. A proper follow-up should normalize/paginate history, define idempotency retention guarantees, and introduce access-aware limits; blindly deleting receipts would compromise recovery.
2. **Collateral computation is synchronous and grows with book size.** Contract history is capped at 500; groups are evaluated against strike boundaries. A local sample took approximately 48 ms for one risk computation at 200 varied two-leg contracts. That is descriptive local evidence, not a VPS throughput guarantee. Production needs load limits and benchmarks on the actual host. Grid points are now deduplicated.
3. **Dependency advisory remains open.** `npm audit` reports `stream-json` and its parent `jayson` for [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x). The advisory concerns path-filter nesting complexity; the installed Solana client imports `jayson/lib/client/browser`, while the application's HTTP bodies use bounded `JSON.parse`. Source inspection found no application use of the affected filters. This lowers observed reachability; it does not erase the installed advisory or justify an untested major-version override.
4. **Real-asset production boundaries remain.** Sessions are no-value cookie-owned test accounts, not wallet authentication. New vault custody, lending and margin execute offchain. Production still needs appropriate custody contracts, signing/identity, live feeds and execution, corporate-action integration, external security review and operational recovery work.
5. **Recovery is tab-local.** A pending intent survives reload in that tab. Clearing browser/session storage or losing the session cookie removes that recovery context; the UI warns against clearing it during an unresolved action. Automatic execution with a new identity is deliberately prevented.

## Release state

The audited fixes and evidence are local and reviewable. Publishing is a separate authorized action: the repository's `AGENTS.md` says, “Never push, publish or open a PR without explicit user authorization.” This audit did not push a branch, open a PR, restart either VPS service, reset the validator, or deploy a new release.
