# Oddlot — options sized to your exposure

Oddlot brings fractional options, covered underwriting and protected stock borrowing into one collateral-aware equity workspace. A share is the denomination, not a minimum lot. Users choose the exposure they need and see the complete obligation before committing capital.

## The gap

Moving stock exposure onchain does not automatically provide appropriately sized options, buyers for covered calls, useful stock borrowing, or trustworthy collateral accounting. Standard contract lots can be too coarse for small portfolios. Separate option and lending escrows make it easy to misunderstand what capital remains available. A small premium can also hide a large exercise-funding requirement.

## What works

Deposit test cash and stock; trade fractional calls, puts and bounded structures; underwrite covered calls or cash-secured puts; lend shares to a borrower that actually sells them; and open a short with a capped repurchase obligation. Review every option leg, exact premium, expiry and post-trade reserve. Covered strategies include their stock exposure in the payoff chart. Close-outs show the amount paid or received before confirmation.

Cross collateral nets only matching reference, expiry and settlement groups. Integer accounting conserves assets and prevents reuse of reserved cash or shares. A sorted strike sweep handles large books without repeated price-grid scans. The browser preserves interrupted actions across reloads and reuses their original request keys.

## Why Solana

The new Oddlot Anchor program independently executes the vault's transfers, option deliveries, collateral checks, productive loans, capped shorts and historical settlement. SPL test-token accounts owned by the vault PDA back its claims. The program compares its computed economic state with the backend's prepared projection; a mismatch fails the transaction. SQLite indexes the result only after confirmation. Signed transaction bytes are durably recorded before broadcast.

This is demonstrated on a **pinned private Solana validator**, not devnet or mainnet. The test maker and session wallets use service-held test signers. The original Strata program is retained for historical reference; it is not used as evidence that Oddlot's new rules execute onchain.

## Product distinction

The thesis is precise exposure plus explicit funding: fractional quantity, editable option ratios, stock-inclusive payoff diagrams and one view of encumbered capital. A borrower sells lent stock, purchases market-backed protection and escrows capped repayment plus interest. Dividend-reference spreads demonstrate another structured payoff without claiming ownership of an issuer distribution.

Fractionality does not change percentage theta or eliminate exercise funding. The default physical call prefunds $145 of strike cash plus approximately $4.04 premium. Bounded cash-settled spreads have a different funding model and payoff.

## Demonstrated evidence

- 19 confirmed current-program actions, including fractional options, closes, productive lending, protected shorts, margin changes, dividend settlement, withdrawals and replay reset.
- 9 independently constructed adversarial transactions rejected by the program: wrong owner/mint, stale revision, expired authorization, insufficient funds, pledged-share withdrawal, mismatched projection, zero-payoff premium and excessive bounded premium.
- 65 application regression tests, 25 real-backend browser journeys and 6 native program tests.
- Current narrated UI recording with a confirmed Oddlot vault account and transaction proof.

See [validation](VALIDATION.md) and the [release audit](../docs/audit/2026-09-15-release/REPORT.md).

## Liquidity and release boundaries

All counterparties and market inventories are funded test allocations. There is **no connected external liquidity provider**, verified option demand, or live borrow utilization. Historical NVIDIA closes are real observations; option premiums are model estimates, not historical option quotes. The issuer token, corporate-action handling, live oracle, user wallet signing and independent security review remain production work. The localnet vault is capped at 64 active positions; the sandbox supports 500.

## Submission assets

- Project source: https://github.com/nichar3232/oddlot — private; these release changes await push authorization.
- Current video: [oddlot-demo.mp4](oddlot-demo.mp4), with [captions](oddlot-demo.vtt).
- Repeatable walkthrough: [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
- Public demo/access: pending publication authorization and judge-access setup.
- Hackathon: [Stocklana](https://hackathons.solana.com/hackathons/stocklana).

Previous Bellwether/Strata entry and video are archived in `legacy/` and are not the current submission.
