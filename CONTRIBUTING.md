# Contributing to Parcel

Use Node from `.nvmrc` and `npm ci --ignore-scripts`. Start with [DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Keep the boundaries clear

- `app/`, `components/oddlot/` and the retained `components/desk/` render the desk. Keep wallet, ledger and settlement decisions out of components.
- `hooks/oddlot/` and `hooks/desk/` coordinate UI requests using the shared types in `lib/contracts/api.ts`.
- `server/oddlot/` owns vault actions, settlement and lending. `server/domain/` owns authorization, validated actions, revisions and durable operations. `server/db/` owns SQL; `server/solana/` owns RPC and instruction serialization.
- `lib/oddlot/` contains delivery-envelope collateral math, pricing and structured-contract terms. `lib/` also contains shared terms, historical scenarios and arithmetic. The server is authoritative even when the client previews a payoff.
- `programs/strata/` owns Anchor escrow constraints. Changes require contract verification and fresh evidence; never reset the shared validator to make a test pass.

## Before a change is ready

```sh
npm run check:repo
npm run check
npx playwright install chromium
npm run test:e2e
```

Use a focused regression test when changing accounting, recovery, permissions or contract behavior. Browser tests start their own backend and need no private keys. Actual chain tests are documented in `ops/README.md`; CI does not have signing credentials.

Describe the problem, resulting behavior and relevant verification. Keep generated builds, runtime databases, real `.env` files and keypairs out of Git. Preserve upstream notices and data provenance. Regenerate the source handoff with `python3 scripts/package-submission.py`; the resulting zip and checksums are local outputs.

Deployment is an explicit operator action. CI never deploys or mutates the VPS. Do not push, publish or open a PR without the owner's authorization for that work.
