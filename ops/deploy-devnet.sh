#!/usr/bin/env bash
# Provision the Parcel program and its two no-value test mints on Solana devnet.
#
# This never touches the private validator, its ledger, or /var/lib/stocklana.
# Devnet gets its own state directory, as PARCEL_CHAIN.md requires: a vault book
# is pinned to the ledger that produced it, and the two are not interchangeable.
#
# Runs anywhere the Agave CLI is installed. Needs a funded deployer; see
# "Funding" in ops/README.md.
#
#   KEYS   directory holding deployer.json and parcel-devnet-program.json
#   STATE  the devnet state directory the server will run from
#   RPC    a dedicated devnet endpoint; the public one rate limits
set -euo pipefail

BIN=${BIN:-$(dirname "$(command -v solana || echo /opt/stocklana/tooling/solana-release/bin/solana)")}
RPC=${RPC:-https://api.devnet.solana.com}
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
SRC_STATE=${KEYS:-/var/lib/stocklana}
STATE=${STATE:-/var/lib/stocklana-devnet}
PROGRAM_KEY=$SRC_STATE/parcel-devnet-program.json
# The checked-in artifact is the one the repository ships and the one the
# audit evidence refers to. Point SO at a fresh build to deploy something
# else deliberately.
REPO=$(cd "$(dirname "$0")/.." && pwd)
SO=${SO:-$REPO/artifacts/parcel-devnet.so}

say() { printf '\n== %s\n' "$1"; }

say "Confirming the RPC is actually devnet"
genesis=$("$BIN/solana" --url "$RPC" genesis-hash)
[ "$genesis" = "$DEVNET_GENESIS" ] || {
  echo "Refusing: $RPC reports genesis $genesis, which is not devnet." >&2
  exit 1
}

say "Checking the artifact and keys"
[ -f "$SO" ] || {
  echo "Missing program artifact $SO." >&2
  echo "Build one with: cd programs/parcel && cargo build-sbf --arch v3 --features devnet" >&2
  exit 1
}
[ -f "$PROGRAM_KEY" ] || { echo "Missing program keypair $PROGRAM_KEY." >&2; exit 1; }
[ -f "$SRC_STATE/deployer.json" ] || { echo "Missing operator key $SRC_STATE/deployer.json." >&2; exit 1; }
program=$("$BIN/solana-keygen" pubkey "$PROGRAM_KEY")
operator=$("$BIN/solana-keygen" pubkey "$SRC_STATE/deployer.json")
echo "program  $program"
echo "operator $operator"

# The program hardcodes its operator, so a deployer that is not that key would
# build a vault no instruction will ever accept. Read the devnet one from the
# source the artifact is built from.
compiled=$(awk '/cfg\(feature = "devnet"\)/ { devnet = 1; next }
  devnet && /const OPERATOR/ { match($0, /"[1-9A-HJ-NP-Za-km-z]+"/); print substr($0, RSTART + 1, RLENGTH - 2); exit }
  { devnet = 0 }' "$REPO/programs/parcel/src/lib.rs")
[ "$operator" = "$compiled" ] || {
  echo "Refusing: the program's compiled devnet OPERATOR ($compiled) is not this deployer." >&2
  exit 1
}

say "Checking funding"
# Devnet SOL is faucet-rationed, so do not take the loader's default of
# twice the binary: that doubles the rent locked up forever to buy upgrade
# headroom nobody has asked for. Take a modest margin instead, and let the
# operator widen it deliberately.
size=$(wc -c < "$SO" | tr -d ' ')
MAX_LEN=${MAX_LEN:-$(( size * 115 / 100 ))}
[ "$MAX_LEN" -ge "$size" ] || { echo "MAX_LEN $MAX_LEN is smaller than the program." >&2; exit 1; }
need=$("$BIN/solana" --url "$RPC" rent "$MAX_LEN" | grep -o '[0-9.]*')
buffer=$("$BIN/solana" --url "$RPC" rent "$size" | grep -o '[0-9.]*')
have=$("$BIN/solana" --url "$RPC" balance "$operator" | grep -o '^[0-9.]*')
echo "program account ($MAX_LEN bytes): $need SOL held for rent"
echo "upload buffer (reclaimed on success): $buffer SOL"
echo "deployer holds: $have SOL"
awk -v h="$have" -v n="$need" -v b="$buffer" 'BEGIN { exit !(h < n + b + 0.2) }' && {
  echo "Refusing: the deploy needs about $(awk -v n="$need" -v b="$buffer" 'BEGIN{printf "%.2f", n+b+0.2}') SOL at peak." >&2
  echo "Fund $operator on devnet, then re-run. See ops/README.md." >&2
  exit 1
}

say "Deploying the program"
"$BIN/solana" --url "$RPC" --keypair "$SRC_STATE/deployer.json" program deploy \
  --program-id "$PROGRAM_KEY" --upgrade-authority "$SRC_STATE/deployer.json" \
  --max-len "$MAX_LEN" "$SO"

say "Creating the two no-value test mints"
mkdir -p "$STATE"
# --mint-authority belongs to create-token, not to spl-token itself, and
# the program refuses any mint whose authority is not its own operator.
mint() {
  "$BIN/spl-token" --url "$RPC" --fee-payer "$SRC_STATE/deployer.json" \
    create-token --decimals 6 --mint-authority "$operator" \
    | grep -o 'Address:  *[1-9A-HJ-NP-Za-km-z]*' | awk '{print $2}'
}
cash=$(mint)
stock=$(mint)
[ -n "$cash" ] && [ -n "$stock" ] && [ "$cash" != "$stock" ] || {
  echo "Refusing: mint creation did not return two distinct addresses." >&2
  exit 1
}
echo "cash  $cash"
echo "stock $stock"
printf '{"cash":"%s","stock":"%s"}\n' "$cash" "$stock" > "$STATE/parcel-devnet-mints.json"

say "Seeding the devnet state directory"
# The adapter reads the operator key from its own state directory. The devnet
# book starts empty; no localnet vault is ever imported into it.
cp "$SRC_STATE/deployer.json" "$STATE/deployer.json"
if id stocklana >/dev/null 2>&1; then chown -R stocklana:stocklana "$STATE"; fi
chmod 600 "$STATE/deployer.json"

say "Done. Service environment (also saved to $STATE/devnet.env):"
# Saved beside the state so a local run is `set -a; . $STATE/devnet.env; set +a`.
tee "$STATE/devnet.env" <<ENV
STRATA_STATE_DIR=$STATE
CHAIN_ENABLED=true
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=$RPC
SOLANA_GENESIS_HASH=$DEVNET_GENESIS
PARCEL_CHAIN_ENABLED=true
PARCEL_PROGRAM_ID=$program
PARCEL_CASH_MINT=$cash
PARCEL_STOCK_MINT=$stock
STRATA_AUTHORITY=$operator
ENV
echo
echo "Verify with: npm run verify:parcel-chain && npm run verify:parcel-adversarial"
echo
echo "Each browser session that goes onchain allocates a 64 KiB vault account,"
echo "which holds about 0.33 SOL of rent for as long as it exists. Budget the"
echo "operator's balance against the number of sessions you expect."
echo "Explorer:    https://explorer.solana.com/address/$program?cluster=devnet"
