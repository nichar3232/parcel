# Parcel

**Options, by the share.**

[![CI](https://github.com/nichar3232/parcel/actions/workflows/ci.yml/badge.svg)](https://github.com/nichar3232/parcel/actions/workflows/ci.yml)

A unified equity workspace for granular options, covered underwriting, stock lending, protected shorts and structured contracts. Size exposure in share-equivalents, including fractional quantities to six decimals; one share is a denomination, not a minimum lot. A contract must have a nonzero payable obligation.

Parcel is a working **private test-asset product**. The same-origin Node API supports a persistent keyless sandbox and **Parcel program execution on a pinned private Solana validator**. In localnet mode, SPL test tokens back the vault and the program independently executes transfers, option deliveries, lending, protected shorts and cross collateral; SQLite indexes confirmed results. Both modes use funded test counterparties and historical prices. This is not a live brokerage or a source of external liquidity. The original Strata spread desk remains at `/legacy`.

![Parcel vault workspace](docs/audit/oddlot/overview.png)

## Start

```sh
git clone https://github.com/nichar3232/parcel.git
cd parcel
npm ci --ignore-scripts
npm run build
npm run demo
```

Use Node 22.23.2 from `.nvmrc`. Open `http://localhost:3025`. This single server serves the frontend **and** API. The complete vault workflow needs no keys. State persists in `.state/strata.sqlite`; the retained filename keeps deployed data compatible. Read [development setup](docs/DEVELOPMENT.md) before changing environment or hosting.

## What works

- **Vault:** deposit/withdraw test USDC and NVDA; inspect available, reserved and lent assets. Pledged assets cannot be withdrawn, sold or lent again.
- **Options chain:** browse calls and puts by strike, daily or hourly expiry, and fractional exposure. Model buy/write indications show physical backing before a funded quote.
- **Sizing:** direct share-equivalents, premium budgets, and dollar sensitivity per one-cent reference move; exercise funding stays explicit.
- **Basic / Advanced:** focused template workflows, with editable sides, ratios, settlement and additional Greeks in Advanced mode.
- **Options:** fractional calls/puts, physical assignment, server-issued 30-second quotes, priced close-out and atomic expiry settlement.
- **Underwriting:** covered calls lock shares; cash-secured puts lock strike cash. Counterparty obligations are also reserved.
- **Structures:** call/put spreads, straddles, strangles, iron condors, butterflies, collars, and capped dividend-reference contracts. Edit up to four legs and whole-number ratios. Add fixed-payout boxes, capped quadratic/exponential contracts, dividend floors, ranges and convexity.
- **Stock lending:** the test borrower sells the stock, buys market-backed call protection, and escrows the capped repurchase amount plus term interest. Recall repurchases principal and credits accrued interest; the market cannot reuse pledged protection stock.
- **Long/short stock:** spot longs are cash funded. Shorts pair the borrow with a covered protective call, and reserve the maximum repurchase cost plus term interest.
- **Cross collateral:** net matching settlement obligations and reuse earlier guaranteed cash receipts for later obligations. Reserve every intermediate cash deficit; unrelated directional positions and outside lenders receive no correlation credit. Isolated mode remains available.
- **Activity:** persistent receipts, transaction history, export, stale-tab protection and safe HTTP retries, including pending-action recovery after reload.

Start by depositing one NVDA share, choose **Underwrite → Covered call**, review the actual premium and reserve, and confirm. Use **Market controls** to advance historical sessions; due positions settle at their exact stored expiry observation. The UI does not fabricate balances after an API failure.

## Code organization

| Area | Responsibility |
|---|---|
| `app/page.tsx`, `components/oddlot/` | New workspace, views, contract editor and payoff chart |
| `hooks/oddlot/use-vault.ts` | Same-origin requests, revisions, recovery and UI state |
| `lib/oddlot/` | Types, six-decimal arithmetic, Greeks, templates and collateral envelopes |
| `server/oddlot/service.ts` | Session ownership, quote lifecycle, atomic actions and receipts |
| `server/oddlot/ledger.ts` | Asset transfers, loans, protected shorts and net expiry settlement |
| `server/db/002-vaults.sql`, `003-vault-chain.sql` | Vaults, quotes and recoverable onchain operations |
| `server/oddlot/chain/`, `programs/oddlot/` | Durable execution coordinator, binary codec and new vault program |
| `app/legacy/`, `server/domain/`, `server/solana/` | Retained historical desk and durable Solana execution |
| `programs/strata/` | Audited original Anchor escrow program |
| `tests/`, `.github/workflows/` | Domain/API regression tests and real-backend browser CI |
| `ops/` | VPS deployment, backup, rollback and restart verification |

## Verify

```sh
npm run check:repo
npm run check
npx playwright install chromium
npm run test:e2e
```

CI runs this flow on Linux from a clean checkout. Tests cover accounting conservation, invalid collateral withdrawal, duplicate and expired quotes, wrong-session access, stale revisions, physical assignment, cross-collateral hedge removal, stock loans, capped shorts, dividends, browser recovery and mobile overflow. The release audit includes 65 application tests, 25 browser journeys, 6 native Rust tests, a 19-action confirmed Parcel chain lifecycle and 9 rejected adversarial program transactions. Actual Solana program verification remains an explicit operator command. See the [findings and verification evidence](docs/audit/2026-09-15-release/REPORT.md).

## Pricing and release boundaries

Hourly test-clock ticks carry the committed daily close forward; they are not historical intraday data. NVDA closes are retained historical observations from January–April 2025. Options use an explicitly labeled Black–Scholes test model with 45% volatility and 4% annual interest; dividend-reference pricing uses an illustrative 80% input. These are not live quotes or historical option premiums. Dollar theta scales with quantity; shrinking a contract does not change percentage decay per share.

Dividend contracts reference the issuer's declared $0.01 dividend for the March 12, 2025 record-date event, payable April 2. They do not transfer dividend ownership or model an xStock multiplier as a cash payment. See [product rules and sources](docs/PRODUCT.md).

Sandbox rules are backend-enforced. Configured localnet vaults execute the matching Parcel program with actual SPL escrow and server-held test signers. Production still requires wallet authentication and client signing, external liquidity, live pricing/oracle feeds, issuer/corporate-action handling and independent program review. Onchain mode limits each vault to 64 active positions for account and transaction compute bounds; sandbox mode supports 500. The original Solana evidence remains local-validator evidence; devnet funding is still an open gate. The prior Bellwether repository has been retired; its history is preserved here as this repository's root commit `ed73929`.

The [original engineering audit](docs/audit/REPORT.md) records the legacy execution review and dependency findings. Two moderate entries remain in an unused upstream streaming parser; there are no critical/high findings in that retained audit. The original audited program artifacts and evidence are preserved. No private keys, runtime databases or real `.env` files belong in this repository.

## Review the current product

The [product-suite verification](docs/audit/2026-09-15-product-suite/REPORT.md) covers this extension. The [Parcel submission](submission/ENTRY.md), [demo script](submission/DEMO_SCRIPT.md), and [narrated video](submission/oddlot-demo.mp4) remain the prior 0.3 release materials; video/live-provider work is outside this product extension. Previous Bellwether/Strata materials are retained in `submission/legacy/` as historical evidence. A fresh keyless clone starts in sandbox mode. See [Parcel localnet setup](docs/ODDLOT_CHAIN.md) to enable the new program; execution never silently falls back to SQLite.
