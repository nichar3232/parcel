# Bellwether

[![CI](https://github.com/nichar3232/bellwether/actions/workflows/ci.yml/badge.svg)](https://github.com/nichar3232/bellwether/actions/workflows/ci.yml)

**Equity protection for markets moving onchain.** Bellwether is the project repository for the **Strata** desk built for Stocklana. The existing interface, recorded walkthrough and deployed Anchor program retain the Strata name so their audit evidence stays easy to follow.

A working equity-protection desk for Stocklana: define a bounded spread, reserve its full payout, accept exact terms, replay historical NVDA prices, settle and claim. The original design is preserved in [docs/reference](docs/reference).

The audited build has a real Node backend, a transactional SQLite portfolio ledger, isolated browser sessions, and real Solana test-token escrow. It runs continuously on the private `trading-01` VPS, port 3025. Resolve its tailnet address with `~/bin/vps ip --ts`.

## Run locally

Use Node 22.23.2 (`.nvmrc`). No wallet or API key is needed for the complete historical practice flow.

```sh
git clone https://github.com/nichar3232/bellwether.git
cd bellwether
npm ci --ignore-scripts
npm run build
npm run demo
```

Open `http://localhost:3025`. The same process serves the built frontend and API. State persists in `.state/strata.sqlite`; clearing browser storage cannot change balances. For hot reload, leave the backend running and run `npm run dev` in another terminal. Its `/api` proxy targets port 3025.

The frontend calls relative `/api/...` routes with the same session cookie. Production serves UI and API on one origin; development proxies `/api` to the backend. Deploying only `dist/client` would omit the backend. See [integration and environment setup](docs/DEVELOPMENT.md).

## Use the demo

1. **Build:** request the default 100-share $120–$140 put spread, premium $400.
2. **Maker:** fund the $2,000 reserve; review as holder and accept.
3. **Position:** advance to expiry; optionally simulate missing data; settle.
4. **Claim:** pay the holder $2,000 and the maker $0. The holder finishes with $11,600 cash. Total cash plus escrow remains $60,000 throughout.
5. **Replay:** compare the DeepSeek, earnings and rebound windows. Stock-only loss in the default scenario is $2,420; the hedge reduces the combined loss to $820.
6. **Build → Try this contract on Solana:** execute a separate real test-token lifecycle. A server-signed market commitment and fully funded offer are atomic. Session-specific maker and holder keys isolate each browser's contracts. The default on-chain observation delay is 90 seconds.

The browser portfolio is a server-authoritative simulation. The Solana dialog is actual program execution. Their balances are intentionally distinct and labeled. Financing is read-only discovery and an illustrative calculator; stock lending is a preview.

## Architecture

| Boundary | Responsibility |
|---|---|
| `app/page.tsx` | Desk shell and navigation |
| `components/desk/views`, `dialogs` | Seven feature views and focused dialogs |
| `hooks/desk` | UI orchestration, API portfolio, recoverable chain requests |
| `lib/engine.ts`, `scenarios.ts` | Shared six-decimal arithmetic, lifecycle and historical dataset |
| `server/app.ts`, `http` | HTTP routing, cookie sessions, CSRF, bounded JSON and static/range serving |
| `server/domain` | Validated portfolio actions and durable chain operation orchestration |
| `server/db` | SQLite WAL, revision checks, receipts, ownership and transaction outbox |
| `server/solana` | Network verification, instruction codec, signed transactions and coherent account reads |
| `programs/strata/src/lib.rs` | Anchor constraints, immutable terms, escrow and claims |

The backend records signed transaction bytes **before** broadcasting. An ambiguous RPC result remains pending. Retries use the same signature, including after restart. Expiration is determined using finalized block height and signature history. Evidence archival cannot turn a confirmed transaction into a failure. Concurrent refreshes preserve newer transaction records.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite starts a separate backend on port 3027. It covers the entire lifecycle, two claims, reload, cancellation, invalid inputs, stale tabs, dropped responses, reconnect, missing observations, and seven views at desktop/mobile widths. Set `E2E_BASE_URL` to test an existing deployment.

On the VPS, `scripts/audit-chain.ts` exercises the actual HTTP API, program and test wallets across three scenarios. `npm run verify:chain` runs the lower-level adversarial contract suite. Both require the dedicated test configuration described in [ops/README.md](ops/README.md).

See [the audit report](docs/audit/REPORT.md), [validation evidence](submission/VALIDATION.md), and [architecture](docs/ARCHITECTURE.md). Tests are project verification, not an independent security certification.

## Data and release boundaries

The retained Yahoo response contains 63 NVDA daily OHLC observations, January 2–April 3, 2025. Source, retrieval time and SHA-256 are in `data/history.json`. `node scripts/import-history.mjs` deterministically rebuilds the normalized snapshot. Premiums are illustrative. Historical closes are immutable settlement inputs; no live Pyth feed or historical option prices are claimed.

The current chain is an isolated Solana validator. Devnet remains unfunded; the design's devnet acceptance gate is still open. The source repository is private on GitHub. Public publication and the hackathon form remain pending. The private app and local submission artifacts are operable. Production oracle proofs, corporate actions, issuer compatibility, outage resolution and external contract review remain production work; no real-value trading is enabled.

Two moderate npm audit entries remain in Jayson's unused server-side streaming dependency. The running SDK uses `jayson/lib/client/browser`, which does not load that parser. No high/critical entries remain. The vulnerable native `bigint-buffer` addon was replaced by the small, tested, pure-JavaScript compatibility package in `vendor/`; this is explicitly a local replacement, not an upstream patch. Details are in the audit report.

Built with React, Vinext, Vite, Base UI/shadcn components, Recharts, Lucide, Solana web3.js, SPL Token and Anchor under their respective licenses. The social preview is AI-generated.

## Repository guide

- [Development and API integration](docs/DEVELOPMENT.md): clean setup, environments, request flow and troubleshooting.
- [Contributing](CONTRIBUTING.md): module boundaries and required checks.
- [Operations](ops/README.md): private VPS deployment, persistence, backups and rollback.
- [Submission materials](submission/README.md): entry text, recorded demo and transaction evidence.

GitHub CI runs the repository hygiene check, typecheck, lint, unit/API tests, production build and browser journeys against a fresh real backend. The test-chain verifier requires a separately provisioned test validator and remains an operator command.
