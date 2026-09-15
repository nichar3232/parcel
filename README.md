# Oddlot

**Options, by the share.**

[![CI](https://github.com/nichar3232/oddlot/actions/workflows/ci.yml/badge.svg)](https://github.com/nichar3232/oddlot/actions/workflows/ci.yml)

A unified equity workspace for granular options, covered underwriting, stock lending, protected shorts and structured contracts. One contract represents one share-equivalent; quantities support six decimal places.

Oddlot is a working **private test-asset product**. Its Node API and SQLite vault ledger execute every deposit, reserve, trade, loan and settlement shown in the interface. The retained Strata desk at `/legacy` separately executes real SPL test-token escrow on an isolated Solana validator. The new vault ledger is not onchain custody or a live brokerage.

![Oddlot vault workspace](docs/audit/oddlot/overview.png)

## Start

```sh
git clone https://github.com/nichar3232/oddlot.git
cd oddlot
npm ci --ignore-scripts
npm run build
npm run demo
```

Use Node 22.23.2 from `.nvmrc`. Open `http://localhost:3025`. This single server serves the frontend **and** API. The complete vault workflow needs no keys. State persists in `.state/strata.sqlite`; the retained filename keeps deployed data compatible. Read [development setup](docs/DEVELOPMENT.md) before changing environment or hosting.

## What works

- **Vault:** deposit/withdraw test USDC and NVDA; inspect available, reserved and lent assets. Pledged assets cannot be withdrawn, sold or lent again.
- **Options:** one-share and fractional calls/puts, physical assignment, server-issued 30-second quotes, close-out and atomic expiry settlement.
- **Underwriting:** covered calls lock shares; cash-secured puts lock strike cash. Counterparty obligations are also reserved.
- **Structures:** call/put spreads, straddles, strangles, iron condors, butterflies, collars, and capped dividend-reference contracts. Edit up to four legs and whole-number ratios.
- **Stock lending:** the test borrower prefunds 150% opening-value cash collateral plus term interest; principal shares remain earmarked. Recall returns shares and accrued interest.
- **Long/short stock:** spot longs are cash funded. Shorts pair the borrow with a covered protective call, and reserve the maximum repurchase cost plus term interest.
- **Cross collateral:** only net obligations within identical reference, expiry and settlement groups. No offsets across dates, references, settlement types or outside lenders. Isolated mode is also enforced.
- **Activity:** persistent receipts, transaction history, export, stale-tab protection and safe HTTP retries.

Start by depositing one NVDA share, choose **Underwrite → Covered call**, review the actual premium and reserve, and confirm. Use **Market controls** to advance historical sessions; due positions settle at their exact stored expiry observation. The UI does not fabricate balances after an API failure.

## Code organization

| Area | Responsibility |
|---|---|
| `app/page.tsx`, `components/oddlot/` | New workspace, views, contract editor and payoff chart |
| `hooks/oddlot/use-vault.ts` | Same-origin requests, revisions, recovery and UI state |
| `lib/oddlot/` | Types, six-decimal arithmetic, Greeks, templates and collateral envelopes |
| `server/oddlot/service.ts` | Session ownership, quote lifecycle, atomic actions and receipts |
| `server/oddlot/ledger.ts` | Asset transfers, loans, protected shorts and net expiry settlement |
| `server/db/002-vaults.sql` | Versioned vault accounts and quote persistence |
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

CI runs this flow on Linux from a clean checkout. Tests cover accounting conservation, invalid collateral withdrawal, duplicate and expired quotes, wrong-session access, stale revisions, physical assignment, cross-collateral hedge removal, stock loans, capped shorts, dividends, browser recovery and mobile overflow. Actual Solana program verification remains an explicit operator command.

## Pricing and release boundaries

NVDA closes are retained historical observations from January–April 2025. Options use an explicitly labeled Black–Scholes test model with 45% volatility and 4% annual interest; dividend-reference pricing uses an illustrative 80% input. These are not live quotes or historical option premiums. Dollar theta scales with quantity; shrinking a contract does not change percentage decay per share.

Dividend contracts reference the issuer's declared $0.01 dividend for the March 12, 2025 record-date event, payable April 2. They do not transfer dividend ownership or model an xStock multiplier as a cash payment. See [product rules and sources](docs/PRODUCT.md).

The new custody, underwriting and margin rules are enforced by the backend test ledger. Production requires wallet authentication, token custody integration, a matching audited program for these new rules, live pricing/oracle feeds, issuer/corporate-action handling and operational release review. The original Solana evidence remains local-validator evidence; devnet funding is still an open gate. Bellwether is left intact as the prior repository.

The [original engineering audit](docs/audit/REPORT.md) records the legacy execution review and dependency findings. Two moderate entries remain in an unused upstream streaming parser; there are no critical/high findings in that retained audit. The original audited program artifacts and evidence are preserved. No private keys, runtime databases or real `.env` files belong in this repository.
