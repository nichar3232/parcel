# Parcel release verification

> The [follow-up audit](2026-09-15-review/REPORT.md) found and corrected gaps in this initial verification. This document is retained as the original release record.

September 15, 2026. This review covers the new granular-options and vault product. Original Strata contract evidence is preserved separately.

## Execution scope

The new vault, option underwriting, cross collateral, stock lending and protected-short flows run through the real HTTP backend and transactional SQLite state. Assets are disclosed test allocations. They are not blockchain token custody. The existing `/legacy` flow retains actual Solana local-validator SPL escrow. No claim is made that the original program enforces the new vault's margin or lending rules.

## Important invariants

- Deposits transfer existing test assets; no request may replace balances or create capital.
- Mutations atomically preserve total USDC and NVDA base units across wallet, vault, test counterparty, test market and funded loan escrows.
- Every quote is session-owned, revision-bound, single-use and valid for 30 seconds; its premium and terms are fixed server-side.
- Same-key retries return a durable receipt. A different body under that key fails. Unknown/foreign quotes fail.
- Required cash and shares are recalculated after every action. Withdrawals, sales, loans and hedge removal cannot underfund another obligation.
- Exact-at-strike options do not exercise. Cash option numerators sum before one rounding step. Physical assignments exchange actual ledger shares and strike cash.
- Cross-collateral groups have identical reference, expiry and settlement type. Both parties reserve the full cash/share delivery envelope. Expiry settles all due legs together.
- The test lender's stock principal remains earmarked in borrower inventory; the borrower escrows collateral and term interest. Recall does not reuse principal or duplicate interest.
- Each short is protected by a share-backed call and full strike/interest reserve. The high-price branch exercises and repays atomically; the low-price branch buys from funded test inventory.
- Dividend-reference settlement uses the stored issuer event. It does not fabricate a token-holder cash dividend or issuer multiplier integration.

## Verification

The application suite contains 44 passing tests: the original 27 plus 17 vault, quote, collateral, lending, pricing and conservation tests. Every strategy template executes and settles. The reserve test samples 2,001 prices for each of 12 templates (24,012 checks), including fractional sizing and the dividend reference. This supplements, rather than substitutes for, the strike-boundary envelope method.

The browser suite has eight new vault journeys and eight retained desk journeys. New flows cover fractional covered assignment and blocked withdrawal, cross/isolated collateral, lending/recall/protected shorts, dividend expiry, all seven desktop/mobile views, dropped responses, stale tabs, and backend reconnect. Tests use an actual HTTP server and database. Local and GitHub CI logs provide the final results.

The browser review corrected accessible field labels and contained table overflow on mobile. Backend serving was extended to resolve the actual exported `/legacy.html` route, rather than returning the new root HTML for the retained desk. The vault table migration is additive and does not rewrite legacy balances or Solana evidence.

## Remaining production work

External signing and identity, custody programs for the new vault rules, real issuer tokens/corporate actions, live execution/oracles, external security review, operational limits and disaster recovery are not implemented by this private test release. All product surfaces label its environment and custody. Pricing is a Black–Scholes test model, not market liquidity. Protected short calls are exercisable on early close; the rest of the physical option book exercises only at expiry.

The original dependency audit reported two moderate entries in an unused upstream streaming parser; no critical/high findings. No upstream dependency changes were required for Parcel. This is builder verification, not an independent financial-security audit.
