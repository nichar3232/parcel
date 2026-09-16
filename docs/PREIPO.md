# Pre-IPO covered calls: Tessera and PreStocks

Fractional, physically settled covered calls written against sponsor-issued
pre-IPO tokens. Quantities are **tokens**, never company shares, and nothing
in this feature uses the sandbox vault ledger: that ledger is accounting, not
on-chain custody, and the two are deliberately kept apart.

## Status, stated plainly

| Piece | State |
|---|---|
| Provider adapters (Tessera, PreStocks) | Working, verified against the live APIs |
| Curated asset registry with issuer terms | Working |
| On-chain mint verification and extension policy | Working against mainnet, read-only |
| Integer terms math and derived strike | Working, unit tested |
| `preipo_covered_call` Anchor program | **Written but never compiled or deployed** |
| Wallet signing, offers, accept/exercise/expire | **Not implemented** |

The program is source-only. There is no Rust, Anchor or Solana toolchain on
this machine (`cargo`, `anchor`, `solana` all absent), so it has not been
built, tested or deployed, and no program id has been reserved. The
`declare_id!` value is a placeholder. Treat every claim about on-chain
behaviour below as *design intent*, not verified behaviour.

Bounty eligibility is not claimed and is not guaranteed.

## Verified provider APIs

Both were probed live on 2026-09-16. Schemas were read, not assumed, and they
differ, which is why each provider has its own parser.

**Tessera** — `GET https://rest-api.tessera.pe/v1/public/token-details` → `200`,
a bare JSON array. The mint field is **`mint`**.

```json
{"id":"T-OpenAI","name":"T-OpenAI","symbol":"T-OpenAI","code":"tOpenAI",
 "sector":"Artificial Intelligence",
 "mint":"oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ",
 "markPrice":812.79,"holders":8259,"markValuation":950000000000}
```

**PreStocks** — `GET https://prestocks.com/api/prestocks` → `200`, a bare JSON
array. The mint field is **`contract_address`**, and there are two distinct
prices (`markPrice` and `tokenPrice`).

```json
{"name":"Anthropic PreStocks","symbol":"ANTHROPIC","contract_address":
 "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw","markPrice":1007.05683324,
 "tokenPrice":956.7206391833798,"supply":7381.972255745}
```

Neither response carries decimals or a token program, so both are read from
the chain. Provider prices are informational labels only; contracts settle on
their own fixed integer USDC totals and never consult these numbers.
Quotes attach to assets **by mint**, never by symbol, so one issuer's price
can never be shown against another issuer's token.

## Verified sponsor mints

Read from mainnet via `getAccountInfo … jsonParsed` on 2026-09-16. All four
are **Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), 9 decimals.

| Token | Mint | Escrowable | Why |
|---|---|---|---|
| Tessera T-OpenAI | `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ` | **Yes** | 20 bps transfer fee, freeze authority set |
| Tessera T-Kalshi | `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ` | **Yes** | 20 bps transfer fee, freeze authority set |
| PreStocks ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | **No** | permanent delegate, pausable, transfer hook, scaled UI amount, confidential transfer |
| PreStocks ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | **No** | same as above |

### Why PreStocks tokens are rejected

This is the central finding, and it is a property of the mints, not a
limitation we chose:

* **Permanent delegate** (`WV9PJN7…Fti5Wc`) — the issuer can move tokens out
  of *any* account, including a program escrow. A buyer could pay the exercise
  amount for collateral that is no longer there.
* **Pausable** — the issuer can halt all transfers. That would block both
  exercise and expiry recovery, breaking the promise that a seller can always
  reclaim collateral without our backend.
* **Transfer hook** — transfers run issuer-controlled code that can reject
  them, and every transfer needs extra accounts this version does not resolve.
* **Scaled UI amount** — the multiplier between displayed amounts and base
  units is mutable by the issuer, so a strike agreed today may not mean the
  same thing at expiry.
* **Confidential transfer** — escrow balances would not be publicly verifiable.

Supporting these safely needs issuer cooperation (a hook allowlist or an
escrow exemption) and a redesign that does not promise unconditional expiry
recovery. Until then the registry lists them, prices them, shows their issuer
terms, and refuses to escrow them, naming every reason in the interface.

Tessera's 20 bps fee is handled rather than rejected: the program sends a
grossed-up amount and then asserts the escrow balance rose by exactly the
contracted quantity, so the buyer never silently absorbs the fee.

## Contract design

Terms are immutable and stored as **totals** in base units. The per-token
strike is derived for display only — deriving it avoids rounding a per-unit
price and multiplying back to a total the buyer cannot actually pay.

Lifecycle: `create` (seller escrows the whole quantity) → `accept` (buyer pays
premium, buyer identity fixed) → `exercise` (buyer pays the full exercise
total and receives every escrowed token atomically) or `expire` (underlying
returns to the seller). `cancel` is seller-only and only while unaccepted.

Rules enforced in the program: chain time only; acceptance deadline ≤ exercise
expiry; exercise allowed from acceptance until strictly before expiry; buyer
funds exercise at exercise time and never prefunds strike cash; `expire` is
permissionless so recovery never depends on our backend; every pinned account
is address-checked to prevent substitution; no partial fills, transfers, cash
settlement, cross-margin or automatic exercise.

## Setup

```bash
# Verification is read-only and needs no keys.
PREIPO_VERIFY_RPC_URL=https://api.mainnet-beta.solana.com
PREIPO_VERIFY_NETWORK=mainnet

# Leave unset until a program is actually built and deployed.
# While unset the UI verifies and prices only, and cannot offer to sign.
PREIPO_PROGRAM_ID=
PREIPO_USDC_MINT=
```

`GET /api/preipo/assets` returns the registry joined with chain facts and
provider prices, plus `executionEnabled`, which is false unless both a program
id and a USDC mint are configured.

## Demo script

1. **Show the two providers.** `curl -s https://rest-api.tessera.pe/v1/public/token-details`
   and `curl -s https://prestocks.com/api/prestocks`. Point out that one calls
   the mint `mint` and the other calls it `contract_address` — separate
   adapters, never interchangeable.
2. **Open Pre-IPO in the app.** Four assets, two issuers, each labelled with
   its issuer and short mint.
3. **Select Tessera T-OpenAI.** Escrowable. The panel shows the verified token
   program, 9 decimals, the network, and discloses the 0.20% transfer fee and
   the issuer's freeze authority.
4. **Write a call:** 0.25 tokens, 6.50 USDC total premium, 225.00 USDC total
   exercise payment. The derived strike reads $900 per token — derived from
   the totals, not stored.
5. **Open the confirmation.** Exact mint, token quantity, both totals, the
   derived strike, the network. It states that the seller keeps the premium
   and all downside while capping upside, and that the buyer's maximum loss is
   the whole premium.
6. **Select PreStocks ANTHROPIC.** Not escrowable, with every blocker named
   from the mint account itself. This is the honest half of the demo: the
   integration reads the real mint and refuses what it cannot secure.
7. **State the limits:** the program is unbuilt, signing is disabled, no
   sponsor tokens move.

## Remaining blockers

1. **No Rust/Anchor/Solana toolchain here** — the program cannot be compiled,
   tested or deployed from this machine. Needed before any on-chain claim.
2. **No program id or deployment authorisation.** Nothing has been deployed
   and nothing may be without explicit approval.
3. **Wallet signing is not implemented.** The design calls for real wallet
   signatures; the existing chain service uses server-derived HMAC session
   keys, which must not be reused here.
4. **Offer persistence and reconciliation are not implemented.** Chain state
   must be authoritative with the database as an index.
5. **Local test mints for lifecycle tests are not yet created.** Automated
   lifecycle tests must run against local mints and must never be presented as
   sponsor-token integration.
6. **PreStocks support needs issuer cooperation**, as above.
