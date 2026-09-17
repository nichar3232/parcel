# Parcel product and collateral rules

## Contract granularity

Each contract quantity is denominated in share-equivalents, not 100-share lots. The numeric quantity range is 0.000001 to 1,000, but the entire payable obligation must survive six-decimal settlement precision. Zero-payoff contracts are rejected before quoting or collecting premium. Leg ratios are integers from 1 to 4, with at most four legs. Six-decimal token amounts use integer base units. Cash-option payoffs sum signed leg numerators before one rounding step.

Quantity scales premium, payoff and dollar Greeks proportionally. It does not change percentage decay or per-share sensitivity. Theta is a model estimate of a day's time decay holding the other inputs fixed, and is not a promised daily earning rate. [OIC theta definition](https://www.optionseducation.org/advancedconcepts/theta).

## Vault custody and transaction boundary

The current vault is a persistent test-asset ledger, with separate funding wallet, vault, test counterparty, and test market inventories. Initial test allocations are explicit and conserved: wallet 10,000 USDC/25 NVDA, counterparty 2,000,000 USDC/10,000 NVDA, market 2,000,000 USDC/10,000 NVDA. Deposits move existing assets; they do not mint more capital. Both sides must remain collateralized.

Every action is owner-filtered and runs inside one SQLite transaction. Before commit, the engine recomputes collateral and compares the total USDC and NVDA base units with the pre-action totals. Loan collateral/interest escrow is included in the USDC total. A failure rolls back balances, positions, quote consumption and receipts together. All mutations require CSRF, an idempotency key and the reviewed revision.

Keyless sandbox custody is backend accounting. Configured localnet vaults use the new `programs/parcel` program and real SPL test-token escrow. The program computes every transition and collateral reserve; it rejects a result that differs from the backend plan. Signed bytes are saved before sending, and SQLite commits the indexed book only after signature confirmation and an account-state comparison. The older `/legacy` spread program remains separate and unchanged.

## Physical and cash settlement

A physical in-the-money call delivers shares to its buyer and strike cash to its writer. A physical put delivers shares from buyer to writer and strike cash to buyer. Exact-at-strike legs expire without exercise. Purchasers fund exercise obligations in advance; this is deliberately different from a premium-only leveraged option account. Calls, puts, straddles, strangles and collars can use physical settlement.

Cash structures require a bounded high-price call tail. Put payoffs remain bounded at a zero stock price. The maximum liability is reserved in USDC. A naked cash-settled call cannot be admitted; select physical delivery or add a cap. Any position may be closed at its current stored-session model price if the remaining portfolio stays funded.

## Cross collateral

Positions net only if reference, expiry and settlement type agree. For each group, evaluate every strike boundary, both sides of that boundary, zero price and the high-price tail. Reserve the worst cash delivery and worst share delivery separately, for both parties. Different payoff groups retain independent worst-case price assumptions. Their signed minimum and maximum cash flows then feed the calendar reserve below. Cash contracts truncate separately to six-decimal settlement units. Cross groups reserve up to one additional base unit per unmatched fractional contract after the first, capped by the sum of isolated reserves. Exactly opposing cash functions cancel without this allowance. All positions due at an expiry clear together, so a zero-reserve offsetting book cannot be broken into an underfunded individual settlement.


In cross mode, aggregate each expiry's guaranteed minimum user cash flow and maximum user cash flow. For each chronological prefix, sum those bounds. User cash reserve is the largest negative minimum prefix, floored at zero; counterparty cash reserve is the largest positive maximum prefix. An earlier fixed-payout box can therefore fund a later short spread. A later box cannot fund an earlier liability, and an ordinary long call spread has zero guaranteed receipt, so it cannot finance a different expiry's short spread. Both sides must remain funded through every intermediate expiry. Stocks remain separately reserved; loan escrow and protected-short obligations are additive. Closing or withdrawing against a needed guaranteed receipt is rejected if it breaks these bounds.

The engine never gives scenario/correlation credit across issuers or outside protocols. This is a delivery-envelope method with a conservative allowance for cross-contract cash rounding, not regulatory portfolio margin. Traditional portfolio margin uses a different model and regulatory framework; [Cboe's explanation](https://www.cboe.com/markets/us/options/margin/portfolio-margining-rules) provides context.

## Lending and protected shorts

A stock loan removes shares from the user's spendable vault. The borrower posts 150% of opening stock value plus the full term's 3.5% annualized test borrow interest. The borrower sells the shares to the funded test market and buys a covered protective call with strike 150% of entry. Market inventory backing that call is reserved. On recall or expiry, cash escrow pays the lesser of spot and cap to repurchase shares, principal returns to the lender, accrued interest is credited, and unused escrow returns to the borrower. This test protection permits capped repurchase on early recall; it is not a vanilla European call quote. This isolated test market does not claim external utilization or market lending rates.

An ordinary short's loss is unbounded. Parcel therefore offers protected shorts only: borrowed shares are sold to a separately funded test market, a share-backed protective call is purchased, and the strike repurchase amount plus full-term interest is locked. This specific protection is exercisable on early close as well as term expiry. If the price exceeds the cap, call delivery and stock repayment occur atomically. Otherwise the stock is repurchased from the market. The initial short proceeds remain collateral. The protective-call premium is nonrefundable when closing early; no model buyback value for that protection is credited.

## Dividend reference

The initial contract is a capped claim on a specified cash-dividend-per-share observation, not an ownership right in a company distribution. NVIDIA declared $0.01 per share, payable April 2, 2025 to holders of record March 12. Parcel uses that record-date event as its explicit test settlement date. [Issuer announcement](https://investor.nvidia.com/news/press-release-details/2025/NVIDIA-Announces-Financial-Results-for-Fourth-Quarter-and-Fiscal-2025/).

Dividends are already a derivatives reference in established markets; this product does not claim to invent dividend derivatives. [CME dividend futures and options](https://www.cmegroup.com/markets/equities/us-index/equity-index-dividend-futures.html).

Issuer mechanics must remain separate. xStocks describes dividend reinvestment and a multiplier; on Solana the base token amount can remain constant while the multiplier changes its represented exposure. A share-equivalent contract must account for those terms before integrating a real issuer token. Parcel's test shares do not claim that integration. [xStocks corporate-action documentation](https://docs.xstocks.fi/docs/dividends-and-stock-splits).

## Current release

The private UI and backend exercise every listed vault workflow with test assets and finite inventories. Local-validator custody for the new vault is implemented and verified. Client wallet signing, real execution liquidity, oracle proofs, issuer eligibility, corporate actions and independent program review remain production requirements. Never relabel this environment or the retained local-validator proof as a mainnet product.

## Capital efficiency and liquidity claims

Fractional size reduces dollar premium, dollar theta and collateral together; it does not change per-share percentage decay. Physical long calls reserve their full strike cash in addition to premium. The initial one-share $145 call therefore needs approximately $149.04 upfront, not just the $4.04 model premium. The separate cash-settled call spread can be premium-funded because its writer reserves the bounded obligation. These are different payoffs and funding models.

Each session receives finite test counterparty and market allocations. This demonstrates funded obligations, not real option demand, borrow utilization, a market-making commitment, or executable external liquidity. A production RFQ must identify a funded maker, bind an expiring signed price, and reserve its inventory before acceptance; unavailable liquidity must result in no quote. No provider is currently connected.

## Precision and performance

The collateral engine sweeps sorted strike events using integer arithmetic. Physical contracts observe both the exact-at-strike and immediately-after-strike delivery states. Cash-settled books use analytic unrounded extrema and a conservative allowance for contract-level truncation; identical opposite contracts cancel exactly. The reserve is capped by the sum of isolated obligations. Withdrawing every permitted free micro-unit must still leave enough to settle. This replaces the quadratic price-grid calculation with O(L log L) work per collateral group, where L is the number of legs.

Covered-call, protective-put and collar charts include the selected quantity of stock marked from the displayed entry reference. They show a modeled strategy, not the user's lifetime tax-lot P&L. The option leg table and signed premium are frozen in the final quote review; close-outs receive an owner-bound quote too. Quote expiry, stale revisions and interrupted actions remain enforced server-side.

## Chain browser, sizing and progressive controls

The authenticated chain endpoint returns revision-bound model indications for eleven surrounding $5 strikes, calls and puts, and a selected six-decimal quantity. Buy and write use a disclosed zero model spread. These indications do not lock liquidity or authorize execution. Selecting a row populates the ordinary builder, then the existing quote/review/execute path reserves actual user and counterparty inventory.

Exposure sizing sets share-equivalents directly. Premium-budget sizing binary-searches the actual rounded backend premium, never exceeding the target or 1,000 share-equivalents; it rejects premium credits and economically empty results. Exercise cash and delivery stock are additional, explicitly displayed requirements. Sensitivity sizing targets absolute model delta times a $0.01 reference move. It is a local estimate, not a guaranteed P&L or a stable hedge ratio. Basic mode keeps template sides/ratios fixed while permitting strike and quantity selection. Advanced enables leg composition, settlement and additional Greeks.

## Hourly test clock

The original daily dates retain their observation indices. Twenty-three hourly ticks are appended for each daily observation except the final window endpoint. Each tick carries that day's committed historical close forward; these are explicitly test-clock observations, not recorded intraday prices or future-close interpolation. Pricing, interest and settlement use actual elapsed hours. Expiry eligibility and all clearing order use chronological time, never the appended observation index. Jumping several days still settles each contract at its own exact expiry observation. The TypeScript table and compiled Rust prices/hours are regression-checked together; regenerate with `npm run generate:parcel-market` and format the Rust source.

## Capped quadratic and exponential contracts

A curve is an alternative to vanilla legs, not an unchecked extra payout: one contract contains either one-to-four vanilla legs or one curve, always cash-settled. Terms fix shape, buy/write side, up/down direction, lower and upper reference boundaries, payout cap per share-equivalent, quantity, reference and expiry. Lower must be less than upper; reference bounds and cap are finite and validated. Writers reserve the full integer maximum obligation. Buyers can lose their premium. The two sides cannot receive or owe more than the committed cap.

Let `x` be reference progress through the clipped range, reversed for a down contract. Quadratic participation is `x²`. Exponential participation is `(exp(4x)-1)/(exp(4)-1)`. Protocol settlement quantizes progress and participation to 12 decimal places. Exponential evaluation uses a deterministic 32-term integer series (stopping once remaining terms are zero), with the denominator generated by the identical series at 4. The cap times quantity is first floored to cash base units, multiplied by the participation fraction, and floored again. A sell contract is the exact negative of that buy amount, including rounding. TypeScript and Rust use the same order of operations. Curves net only identical opposite terms and quantities; different curves retain conservative standalone bounds.

Curve premiums use fixed numerical quadrature of the disclosed lognormal test model; settlement never uses floating-point pricing or a chart sample. Greeks are numerical model estimates. The final confirmation freezes every curve parameter, maximum payout, expiry, side and signed premium. Closing requests a new priced quote and preserves collateral needed by remaining contracts.

Dividend choices include upside spreads, floor spreads, range butterflies, and capped curves with both purchase and underwriting sides. They all reference the same explicit March 12 cash-dividend event; this expansion does not invent additional issuer observations or transfer dividend ownership.
