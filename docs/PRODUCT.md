# Oddlot product and collateral rules

## Contract granularity

Each contract quantity is denominated in share-equivalents, not 100-share lots. The minimum quantity is 0.000001 and the maximum is 1,000. Leg ratios are integers from 1 to 4, with at most four legs. Six-decimal token amounts use integer base units. Cash-option payoffs sum signed leg numerators before one rounding step.

Quantity scales premium, payoff and dollar Greeks proportionally. It does not change percentage decay or per-share sensitivity. Theta is a model estimate of a day's time decay holding the other inputs fixed, and is not a promised daily earning rate. [OIC theta definition](https://www.optionseducation.org/advancedconcepts/theta).

## Vault custody and transaction boundary

The current vault is a persistent test-asset ledger, with separate funding wallet, vault, test counterparty, and test market inventories. Initial test allocations are explicit and conserved: wallet 10,000 USDC/25 NVDA, counterparty 2,000,000 USDC/10,000 NVDA, market 2,000,000 USDC/10,000 NVDA. Deposits move existing assets; they do not mint more capital. Both sides must remain collateralized.

Every action is owner-filtered and runs inside one SQLite transaction. Before commit, the engine recomputes collateral and compares the total USDC and NVDA base units with the pre-action totals. Loan collateral/interest escrow is included in the USDC total. A failure rolls back balances, positions, quote consumption and receipts together. All mutations require CSRF, an idempotency key and the reviewed revision.

This custody is not onchain. The retained `/legacy` desk separately exposes actual Solana program escrow. We do not imply that the original spread program enforces new physical, lending or cross-collateral rules.

## Physical and cash settlement

A physical in-the-money call delivers shares to its buyer and strike cash to its writer. A physical put delivers shares from buyer to writer and strike cash to buyer. Exact-at-strike legs expire without exercise. Purchasers fund exercise obligations in advance; this is deliberately different from a premium-only leveraged option account. Calls, puts, straddles, strangles and collars can use physical settlement.

Cash structures require a bounded high-price call tail. Put payoffs remain bounded at a zero stock price. The maximum liability is reserved in USDC. A naked cash-settled call cannot be admitted; select physical delivery or add a cap. Any position may be closed at its current stored-session model price if the remaining portfolio stays funded.

## Cross collateral

Positions net only if reference, expiry and settlement type agree. For each group, evaluate every strike boundary, both sides of that boundary, zero price and the high-price tail. Reserve the worst cash delivery and worst share delivery separately, for both parties. Cross cash and physical groups never offset; neither do different expiries or dividend references. Cash contracts truncate separately to six-decimal settlement units. Cross groups reserve up to one additional base unit per unmatched fractional contract after the first, capped by the sum of isolated reserves. Exactly opposing cash functions cancel without this allowance. All positions due at an expiry clear together, so a zero-reserve offsetting book cannot be broken into an underfunded individual settlement.

The engine never gives scenario/correlation credit across issuers or outside protocols. This is a delivery-envelope method with a conservative allowance for cross-contract cash rounding, not regulatory portfolio margin. Traditional portfolio margin uses a different model and regulatory framework; [Cboe's explanation](https://www.cboe.com/markets/us/options/margin/portfolio-margining-rules) provides context.

## Lending and protected shorts

A stock loan removes shares from the user's spendable vault. The borrower posts 150% of opening stock value plus the full term's 3.5% annualized test borrow interest. Borrowed principal shares remain earmarked in borrower inventory and cannot back new option obligations. A recall returns those shares, earned pro-rata interest and the borrower's unused collateral. This isolated test market does not claim external utilization or market lending rates.

An ordinary short's loss is unbounded. Oddlot therefore offers protected shorts only: borrowed shares are sold to a separately funded test market, a share-backed protective call is purchased, and the strike repurchase amount plus full-term interest is locked. This specific protection is exercisable on early close as well as term expiry. If the price exceeds the cap, call delivery and stock repayment occur atomically. Otherwise the stock is repurchased from the market. The initial short proceeds remain collateral. The protective-call premium is nonrefundable when closing early; no model buyback value for that protection is credited.

## Dividend reference

The initial contract is a capped claim on a specified cash-dividend-per-share observation, not an ownership right in a company distribution. NVIDIA declared $0.01 per share, payable April 2, 2025 to holders of record March 12. Oddlot uses that record-date event as its explicit test settlement date. [Issuer announcement](https://investor.nvidia.com/news/press-release-details/2025/NVIDIA-Announces-Financial-Results-for-Fourth-Quarter-and-Fiscal-2025/).

Dividends are already a derivatives reference in established markets; this product does not claim to invent dividend derivatives. [CME dividend futures and options](https://www.cmegroup.com/markets/equities/us-index/equity-index-dividend-futures.html).

Issuer mechanics must remain separate. xStocks describes dividend reinvestment and a multiplier; on Solana the base token amount can remain constant while the multiplier changes its represented exposure. A share-equivalent contract must account for those terms before integrating a real issuer token. Oddlot's test shares do not claim that integration. [xStocks corporate-action documentation](https://docs.xstocks.fi/docs/dividends-and-stock-splits).

## Current release

The private UI and backend exercise every listed vault workflow with test assets and finite inventories. Onchain custody for the new vault, wallet signing, live execution liquidity, oracle proofs, issuer eligibility, corporate actions and external program review remain separate production requirements. Never relabel this environment or the retained local-validator proof as a mainnet product.
