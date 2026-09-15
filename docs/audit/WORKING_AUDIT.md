> Completed audit: see [REPORT.md](REPORT.md) and [validation](../../submission/VALIDATION.md). The notes below preserve the initial findings; final dispositions supersede them.

# Audit and remediation scope

The first implementation is not the acceptance baseline. The audit covers maintainability, financial invariants, persistence, session isolation, transaction submission/recovery, API contracts, dependencies, deployment, and actual browser journeys.

Confirmed initial findings:

1. UI state and seven views in one ~3,000-line component; explicit `any` and React compiler/lint failures.
2. Primary practice portfolio is browser-only, mutable through localStorage, with no backend concurrency control.
3. JSON chain sessions are written non-atomically and cannot reconcile interrupted funding reliably: signature is recorded only after confirmation and evidence archival can throw after funds move.
4. Chain request locks are process-local and checked before asynchronous body reads; public verification can race interactive transactions.
5. Network identity is inferred from a URL substring, allowing mislabeled or wrong-network operation.
6. Health reports success without checking database/RPC/mint/program readiness.
7. Session ownership and durable request idempotency are missing. All participants share test wallets.
8. Lifecycle validation differs between client and server; fractional reserve arithmetic and historical timestamp handling differ.
9. React date/clock render and first-screen state have not been tested in a real browser. Failure recovery and multiple tabs are not covered.
10. Known dependency findings, a broken default start script, unused scaffold files, stale evidence/demo claims and no repeatable clean backend bootstrap.

Work will be accepted only with a tested API-backed portfolio; independent session isolation; transactional state/idempotency; typed split UI; real Solana confirmation/recovery checks; restart and negative-path tests; desktop/mobile browser coverage; clear startup/deployment instructions and current demo evidence. Mainnet, live equity oracles and unverified external lending remain outside this test-value hackathon release.
