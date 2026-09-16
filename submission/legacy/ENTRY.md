# Bellwether · Strata

## One sentence

An onchain equity desk that lets stock holders define downside protection, verify the counterparty's full payout reserve, and follow settlement from quote to claim.

## Problem and user

A tokenized-stock holder can own equity exposure in a wallet, but protecting that exposure still involves fragmented tools and uncertain obligations. The token may trade when the underlying exchange is closed. Its price can diverge from the equity reference. Collateral can be scattered across wallets, derivative escrows and lending venues. Moving the asset onchain does not by itself solve any of these problems.

## What we built

Strata joins a portfolio, bounded-spread builder, manual maker workspace, funded-offer review, settlement and claims. A put spread offsets a stock decline inside an explicit range. A call spread gives capped upside. The maker reserves the maximum payout before the holder accepts. Every party sees premium, maximum loss, maximum payout and the limits of protection.

A historical replay lab makes the result tangible. Judges can replay three actual NVIDIA market windows, build a structure, compare stock-only and stock-plus-hedge outcomes, and introduce a hypothetical stock-token discount. Prices are historical; premiums and practice trades are explicitly simulated.

The interactive Solana flow uses a compiled Anchor program, session-specific test wallets and real SPL-token escrow. A Node API and SQLite ledger provide durable practice portfolios, revision checks, session isolation and idempotent requests. Signed Solana transactions are persisted before broadcast and recovered after interruptions. It includes exact-term acceptance, missing-data recovery and separate claims. The current recorded evidence is from an isolated Solana validator. **Devnet deployment is not yet complete because public faucet requests were rejected. Do not describe the local-validator proof as devnet.**

## Why Solana

A funded offer makes the counterparty's reserve observable before acceptance. One transaction validates exact terms, pays the premium and activates the obligation. Program-controlled collateral cannot be promised to two contracts. Settlement and claims can be submitted without trusting the UI, and a third-party keeper can retry safely. Solana is the execution and custody layer, not merely a receipt for offchain trades.

The live historical demonstrator uses one approved test authority and precommitted data. A verified production equity oracle is a separate integration gate.

## What is distinctive

The differentiation is an integrated risk workflow with recoverable execution: readable custom payoffs, a complete view of encumbered capital, explicit stock-token basis risk, and inspectable settlement. The replay teaches exactly what the hedge does and does not cover. We do not claim to be the first options protocol or a regulated prime broker.

## Demo

1. Open the DeepSeek replay. Entry is January 24, 2025, at $142.62 per NVDA share.
2. Build 100 share-equivalents of $120–$140 put-spread protection, with an illustrative $400 premium.
3. Switch to Maker and fund the $2,000 maximum payout. Review and accept as holder.
4. Advance to January 27's stored $118.42 close. Stock-only loss is $2,420. The derivative pays $2,000, net of premium $1,600. Combined loss is $820.
5. Show that below $120, further equity losses resume. Introduce a simulated token discount: the equity derivative does not erase issuer/basis risk.
6. Settle and claim as each party. Toggle missing observation to show that collateral stays locked until the committed sample is available.
7. Use “Try this contract on Solana” to demonstrate the actual program flow; inspect its network label, vault balance, two wallets and transaction proofs.

## Scope and limitations

Borrowing is read-only discovery; stock lending is a product preview. No unverified liquidity, rates, yields or counterparties are displayed. Gross reservations are used; a separate derivative does not increase an external lender's borrowing capacity. Production oracle proofs, corporate actions, issuer compatibility, legal eligibility and external contract review remain release gates.

## Submission links to fill at publication

- Public demo URL: pending publication authorization
- Video: `strata-demo.mp4` in this submission folder
- Repository: https://github.com/nichar3232/oddlot (private; public access remains a submission gate). This entry's code is the root commit `ed73929` — recover it with `git archive ed73929`.

## Sources and open-source disclosure

- [Stocklana rules](https://hackathons.solana.com/hackathons/stocklana)
- [xStocks issuer documentation](https://docs.xstocks.fi/docs)
- [Pyth developer documentation](https://docs.pyth.network/)
- [Kamino lending integration documentation](https://kamino.com/docs/build/developers/borrow)
- Historical observations: source URL and checksum in `data/history.json`
- React, Vinext, Vite, shadcn/Base UI, Recharts, Lucide, Anchor, Solana web3.js and SPL Token; respective upstream licenses apply. The social card was AI-generated.
