# Parcel — options sized to your exposure

Parcel brings fractional options, covered underwriting and protected stock borrowing into one collateral-aware equity workspace. A share is the denomination, not a minimum lot. Users choose the exposure they need and see the complete obligation before committing capital.

## The gap

Moving stock exposure onchain does not automatically provide appropriately sized options, buyers for covered calls, useful stock borrowing, or trustworthy collateral accounting. Standard contract lots can be too coarse for small portfolios. Separate option and lending escrows make it easy to misunderstand what capital remains available. A small premium can also hide a large exercise-funding requirement.

## What works

Deposit test cash and stock; trade fractional calls, puts and bounded structures; underwrite covered calls or cash-secured puts; lend shares to a borrower that actually sells them; and open a short with a capped repurchase obligation. Review every option leg, exact premium, expiry and post-trade reserve. Covered strategies include their stock exposure in the payoff chart. Close-outs show the amount paid or received before confirmation.

Cross collateral nets only matching reference, expiry and settlement groups. Integer accounting conserves assets and prevents reuse of reserved cash or shares. A sorted strike sweep handles large books without repeated price-grid scans. The browser preserves interrupted actions across reloads and reuses their original request keys.

## Why Solana

The new Parcel Anchor program independently executes the vault's transfers, option deliveries, collateral checks, productive loans, capped shorts and historical settlement. SPL test-token accounts owned by the vault PDA back its claims. The program compares its computed economic state with the backend's prepared projection; a mismatch fails the transaction. SQLite indexes the result only after confirmation. Signed transaction bytes are durably recorded before broadcast.

The program is **deployed on Solana devnet** as [`A4NTJ45BZT951nYh5xDXUKtyWij3YrYjcngyMigsq9pG`](https://explorer.solana.com/address/A4NTJ45BZT951nYh5xDXUKtyWij3YrYjcngyMigsq9pG?cluster=devnet), with its own six-decimal test mints, where an `ExecuteV2` deposit is [confirmed at slot 500838076](https://explorer.solana.com/tx/2deYB8yXRadMpsLJn1Q8MxSyrPyntsNr7XrDiyG2AkKoNGwxNLeZBY5TGPcoz3k4vB1CghzgAuBBeKoeoinhtdcn?cluster=devnet) — anyone can check that without our infrastructure.

The 19-action lifecycle and all 14 adversarial rejections are confirmed **on devnet** as well as on the pinned private validator, which runs the same program built from the same source under a separate id. Devnet evidence: [chain](parcel-devnet-chain-evidence.json), [adversarial](parcel-devnet-adversarial.json). Mainnet is refused by the genesis pin and cannot be configured. The test maker and session wallets use service-held test signers, which is not user wallet authentication or self custody. The original Strata program is retained for historical reference; it is not used as evidence that Parcel's new rules execute onchain.

## Product distinction

The thesis is precise exposure plus explicit funding: fractional quantity, editable option ratios, stock-inclusive payoff diagrams and one view of encumbered capital. A borrower sells lent stock, purchases market-backed protection and escrows capped repayment plus interest. Dividend-reference spreads demonstrate another structured payoff without claiming ownership of an issuer distribution.

Fractionality does not change percentage theta or eliminate exercise funding. The default physical call prefunds $145 of strike cash plus approximately $4.04 premium. Bounded cash-settled spreads have a different funding model and payoff.

## Demonstrated evidence

- 19 confirmed current-program actions, including fractional options, closes, productive lending, protected shorts, margin changes, dividend settlement, withdrawals and replay reset.
- 14 independently constructed adversarial transactions rejected by the program: a transaction signed by the owner alone, one signed by the operator alone, wrong owner/mint, stale revision, expired authorization, insufficient funds, pledged-share withdrawal, mismatched projection, zero-payoff premium, excessive bounded premium and three malformed curves. Neither signature is sufficient on its own.
- 129 application regression tests, 43 real-backend browser journeys and 8 native program tests.
- Current narrated UI recording with a confirmed Parcel vault account and transaction proof.

See [validation](VALIDATION.md) and the [release audit](../docs/audit/2026-09-15-release/REPORT.md).

## Liquidity and release boundaries

All counterparties and market inventories are funded test allocations. There is **no connected external liquidity provider**, verified option demand, or live borrow utilization. Historical NVIDIA closes are real observations; option premiums are model estimates, not historical option quotes. The issuer token, corporate-action handling, live oracle, user wallet signing and independent security review remain production work. The localnet vault is capped at 64 active positions; the sandbox supports 500.

## Submission assets

- Project source: https://github.com/nichar3232/parcel — private; these release changes await push authorization.
- Current video: [parcel-demo.mp4](parcel-demo.mp4), with [captions](parcel-demo.vtt).
- Repeatable walkthrough: [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
- Onchain, publicly checkable: program [`A4NTJ45B…`](https://explorer.solana.com/address/A4NTJ45BZT951nYh5xDXUKtyWij3YrYjcngyMigsq9pG?cluster=devnet) on devnet, cash mint `5wbtrHgkfssqreoTkyQKwgrUWqyV85otjgNkdEoAiETr`, stock mint `HWhEjmFRxXFQPDV6NPcxaX1zbeiRxWP2qAvJ5ud3vC3z`.
- Public demo/access: pending publication authorization and judge-access setup.
- Hackathon: [Stocklana](https://hackathons.solana.com/hackathons/stocklana).

Previous Bellwether/Strata entry and video are archived in `legacy/` and are not the current submission.
