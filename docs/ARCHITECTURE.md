# Parcel architecture

The new vault engine is specified in [PRODUCT.md](PRODUCT.md) and [DEVELOPMENT.md](DEVELOPMENT.md). It adds owner-scoped `vault_accounts` and `vault_quotes`, a settlement collateral engine with cross-contract rounding protection in `lib/parcel`, and atomic actions in `server/parcel`. The browser delegates all execution to that service. Custody is explicitly either persistent sandbox accounting or the current private-validator Parcel protocol.

The default Explore view is a presentation layer over the same engine. `lib/parcel/explore.ts` builds validated fractional presets and model illustrations; `ExploreView` reuses `PayoffChart`, including underlying shares for protective puts and covered calls. Exploring does not mutate the vault. Opening a setup passes its complete terms to `OptionsView`, which requests the normal server-authoritative funded quote before confirmation. Displayed standalone exercise backing is not a portfolio collateral quote.

## Vault boundaries

```mermaid
flowchart LR
  View[Parcel feature views] --> Controller[useVault controller]
  Controller --> Transport[Shared same-origin HTTP client]
  Transport --> HTTP[Session and CSRF guarded vault routes]
  HTTP --> Service[VaultService: revisions, quotes, receipts]
  Service --> Ledger[Ledger: transfers and settlement]
  Ledger --> Risk[Pure collateral and base-unit math]
  Service --> DB[(SQLite transaction)]
  View --> Validation[Shared term validation]
  Service --> Validation
```

Views send intent, never replacement balances. `lib/client/api.ts` owns transport; `lib/client/pending-vault.ts` stores only a tab-local pending intent and idempotency key. `useVault` keeps the authoritative snapshot and accepts account changes only through the latest session refresh. A delayed response from another session cannot update the current view. A transport failure, server error, or unreadable response is ambiguous: the original mutation remains recoverable after reload, and new mutations are blocked until it resolves. Session storage contains no session cookie or full CSRF token.

`lib/parcel/validation.ts` is used before rendering option math and again at the server boundary. Quote responses are discarded when the draft changes. Quotes bind the stored account revision; reviewed stock/lending actions also preserve their original revision and displayed price. SQLite infrastructure failures remain server errors; rejected product rules return a conflict.

| Vault route               | Input and result                                              |
| ------------------------- | ------------------------------------------------------------- |
| `GET /api/vault`          | Session-owned book, revision, market and collateral           |
| `POST /api/vault/quote`   | `{revision, terms}` → owner-bound, expiring quote             |
| `POST /api/vault/actions` | `{revision, action}` → committed snapshot and durable receipt |

The retained Strata/Solana execution architecture below remains available at `/legacy`; its program does not implement the new vault rules.

# Runtime and trust boundaries

```mermaid
flowchart LR
  U[Browser feature views] --> H[Typed API hooks]
  H --> A[Same-origin Node HTTP API]
  A --> S[Session + CSRF + input validation]
  S --> P[Portfolio service]
  P --> D[(SQLite WAL)]
  S --> C[Chain service]
  C --> D
  C --> O[Persist signed transaction]
  O --> R[Pinned Solana test RPC]
  R --> X[Anchor program + SPL escrow]
  X --> C
  C --> E[Optional archived proof]
```

## Portfolio transactions

The browser never sends a replacement book. It submits an action, reviewed revision and idempotency key. `BEGIN IMMEDIATE` serializes mutations. A matching receipt returns the original result; a reused key with different input or stale revision returns 409. The server generates RFQ identity, uses its own clock, validates shared terms and reads settlement prices from the retained dataset. Cash movement uses integer base units; conservation is checked before commit.

SQLite contains sessions, portfolios, receipts, chain positions, operations and audit events. Session tokens are random 256-bit values, stored only as SHA-256 hashes. Cookies are HttpOnly/SameSite=Strict, with Secure enabled for HTTPS. Session life is 30 days. Browser possession of the cookie grants access to that isolated no-value demo session; this is not an identity/KYC system.

## Chain transaction state machine

`prepared → submitted → confirmed | failed`

Preparation verifies the configured genesis hash, executable program, six-decimal mint authority and test fee balance. Only explicit localnet/devnet configuration is accepted; mainnet genesis is rejected. Localnet requires loopback RPC. Instructions are simulated before persistence to reject known invalid actions without creating an ambiguous operation.

Before any send, the database commits immutable contract identity, signature, serialized signed transaction, last valid block height and operation key. One unresolved operation is permitted per contract. Same-session preparation is serialized; database uniqueness also prevents duplicate cross-process insertion. No RPC call runs inside a database write transaction.

A transport failure does not prove a transaction failed. Reconciliation queries signature history and, while valid, re-broadcasts the same bytes. Only an explicit on-chain error or finalized expiration without a signature marks failure. Confirmed signatures are stored before optional proof retrieval. Reads fetch offer, vault and the Clock sysvar at one RPC context slot. The UI uses this chain time for deadlines; it never enables settlement using wall time. A delayed read cannot replace a newer observation or erase transaction evidence.

Every browser session derives independent holder and maker **test** keys with HMAC-SHA256 from the dedicated authority secret and session ID. Only the dedicated no-value authority stays on disk. A funded offer atomically creates associated token accounts as needed, mints disclosed test capital, funds account rent, creates the committed market and deposits full reserve. This is demo provisioning, not live liquidity.

## HTTP contract

| Route                                        | Purpose                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/session`                           | Start/resume session, book, revision, CSRF and server time                               |
| `GET /api/portfolio`                         | Authoritative book                                                                       |
| `POST /api/portfolio/actions`                | `{revision, action}`; CSRF and Idempotency-Key required                                  |
| `GET /api/chain/positions`                   | Session-owned contract list                                                              |
| `GET /api/chain/positions/:id`               | Reconcile already-authorized operation and read chain                                    |
| `POST /api/chain/action`                     | fund/accept/cancel/settle/claim-holder/claim-maker                                       |
| `GET /api/evidence`                          | Saved adversarial verification report                                                    |
| `GET /api/chain/tx/:signature`               | Live or explicitly archived transaction proof                                            |
| `GET /api/health`                            | HTTP/database liveness plus detailed chain status                                        |
| `GET /api/ready`                             | 200 only when database/chain are ready and, if required, real-time NBBO is authenticated |
| `GET /api/marks`                             | Current display-mark snapshot with source, timestamp and bid/ask provenance              |
| `GET /api/marks/stream`                      | Same-origin coalesced Server-Sent Event mark stream; vendor credentials never leave Node |
| `GET /api/xstocks`                           | Current issuer xStocks catalog filtered to Solana deployments; public, cached read       |
| `GET /api/xstocks/quotes?symbols=...`        | Current issuer indicative quotes for at most 50 catalog symbols; public, never simulated |
| `GET /api/tokenized-equities`                | Source-qualified declared Solana equity-token registries across configured issuers       |
| `GET /api/tokenized-equities/quotes?ids=...` | Direct issuer quotes for at most 50 source-qualified watched tokens; never simulated     |

Mutation bodies are JSON and at most 16 KiB. Cross-site origins and incorrect CSRF tokens are rejected. Errors use `{error, code}`. Static files support GET/HEAD, ETags, video byte ranges and rooted path checks. The long-running contract verifier is a CLI, not a public mutation route.

## Contract review

Anchor verifies signer identity, mint/token-program ownership, vault authority, party relationships, market identity and PDA seeds. Funded terms are immutable. Acceptance must match every serialized term and precede the quote deadline. Reserve uses checked u128 multiplication and one downward division. Payout cannot exceed reserve. Missing data retains escrow; either named party claims its entitlement once. The two claims consume exactly the original reserve.

The market authority is a trusted test oracle. Dataset/feed identity is stored, but this is not an external oracle proof. Market/offer accounts are retained, so rent is not reclaimed. Unsolicited token donations beyond the contracted reserve have no withdrawal path. There is no contractual permanent-outage refund, production corporate-action adjustment, margin netting or lending execution. These are explicit product/release boundaries.

## Current Parcel onchain mode

The release adds `server/parcel/chain/{codec,adapter,coordinator}.ts` and `programs/parcel`. The program independently executes the current vault rules with SPL backing. The keyless sandbox remains explicit. `VaultService.plan` derives a candidate without committing it; `commit` records the result into the account book, idempotent `receipts`, queryable `vault_mutations`, and `audit_events` in one transaction. The chain coordinator saves a plan and signed bytes before RPC sends, verifies confirmation and program state, then commits the index and stamps `vault_chain_operations` with `action_type`, `signature` and `revision_after`. The database permits one pending operation per owner. See [PARCEL_CHAIN.md](PARCEL_CHAIN.md) for configuration, signer trust, limits and recovery.

The original architecture descriptions above remain specific to their named mode or to the legacy Strata program. Current Parcel program evidence is in `docs/audit/2026-09-15-release`, not the original Strata proof directory.

## Product suite protocol (0.4)

`server/parcel/catalog.ts` supplies read-only chain indications and sizing. Shared response contracts live in `lib/parcel/types.ts`; the browser has no runtime import from server modules. POST `/api/vault/chain` takes `{revision, expiry, quantity}`; POST `/api/vault/size` takes `{revision, terms, mode, target}`. Both reuse session, CSRF, size limits and revision guards. Neither commits balances or creates executable liquidity. All fills still use `/quote` and `/actions` with durable receipt recovery.

`lib/parcel/curves.ts` defines integer nonlinear settlement and numerical model pricing, `envelope.ts` proves per-group bounds, and `risk.ts` reserves chronological cash prefixes. `CurveEditor`, `SizingControl` and `OptionsChain` are isolated view components. The shared controller owns transport; stale chain/sizing replies cannot replace a newer draft. Basic controls and mobile strike cards are presentation choices, not separate accounting implementations.

The chain codec appends an optional curve to serialized terms. Program entrypoints are `initialize_v3` and `execute_v3`, with a stable version-two signer domain that preserves the deployed account identity. Dates are Unix-ms instants: replay observations price at the compiled table, and later (live) instants at the operator-attested mark and closes carried in the action's `Tick`. Existing SQLite vanilla books remain readable without rewriting balances. V1 program accounts and pending operations must stay with their V1 deployment; they are not reinterpreted or upgraded in place.
