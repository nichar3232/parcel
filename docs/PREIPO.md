# PreStocks catalog and asset review

Parcel uses PreStocks as its sole private-market publisher. A PreStocks token
is not company stock: it is publisher-issued exposure to an underlying private
company. The Portfolio Watchlist reads the publisher’s whole public catalog so
a new listing can be searched and followed immediately. That is deliberately
separate from Parcel’s reviewed asset registry and from any escrow workflow.

## Publisher data

`GET https://prestocks.com/api/prestocks` returns a JSON array. Parcel retains
every field the source currently publishes:

| Field                                         | Use in Parcel                                    |
| --------------------------------------------- | ------------------------------------------------ |
| `name`, `symbol`, `description`               | Search and company identification                |
| `image`, `external_url`                       | Publisher-provided logo and source link          |
| `contract_address`                            | Token mint identity; never matched by name alone |
| `markPrice`, `tokenPrice`                     | Current publisher marks, shown separately        |
| `markValuation`, `impliedValuation`, `supply` | Context for the watchlist                        |

The client calls Parcel’s same-origin `/api/preipo/assets` route, not the
publisher directly. The server retries transient upstream failures, caches a
successful response for one minute, and serves the last complete catalog if a
later refresh fails. A publisher mark is informational only; it never settles
a Parcel contract or replaces a committed replay close.

## Watchlist behavior

The Watchlist tab sits under Portfolio. It initially follows the complete
current PreStocks catalog and stores removals and additions in the browser.
Search always queries the full current publisher catalog, so an item removed
from the view can be restored and a later publisher listing can be added
without a release.

The watchlist intentionally does not draw price-history charts: the publisher
API supplies point-in-time fields, not historical observations. It instead
shows the current mark, token price, implied valuation and token-to-mark
difference with the publisher’s own company description and source link.

## Registry and escrow boundary

Publisher listings are useful to watch, but not automatically safe collateral.
The pre-IPO registry is a small, human-reviewed set of PreStocks mints. Before
one can be considered for a contract, Parcel reads its mainnet mint account and
checks the token program, decimals and Token-2022 extensions. Quotes attach by
mint address, never by company name or symbol.

Current PreStocks mints disclose issuer-controlled features such as permanent
delegate, pausable transfers, transfer hooks and a mutable scaled UI amount.
Those features prevent Parcel from promising reliable independent escrow and
expiry recovery, so the desk clearly lists the publisher data and blocks an
unsupported escrow workflow rather than pretending a watchlist entry is
trade-ready.

## Setup

```sh
# Read-only verification; no secrets are needed.
PREIPO_VERIFY_RPC_URL=https://api.mainnet-beta.solana.com
PREIPO_VERIFY_NETWORK=mainnet

# Leave unset until a separate program is built and deployed.
PREIPO_PROGRAM_ID=
PREIPO_USDC_MINT=
```

`GET /api/preipo/assets` returns both `catalog` (every current publisher
listing) and `assets` (the reviewed registry joined with on-chain mint facts).
The route also returns any source warning and `refreshedAt`, allowing the UI to
state exactly what it knows without inventing market history or approval.
