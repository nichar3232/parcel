#!/usr/bin/env bash
# Start the Parcel desk against Solana devnet: `npm run demo:devnet`.
# Reads ~/.parcel-devnet/state/devnet.env (never changes it), frees the
# port, builds, checks the operator's SOL, then runs the server in the
# foreground. Ctrl+C stops it. PORT overrides 3025.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PORT=${PORT:-3025}
ENV_FILE=${PARCEL_DEVNET_ENV:-$HOME/.parcel-devnet/state/devnet.env}
OPERATOR=7K12outW8HdaD7McqqGD2nTJW55nd7eYeqxMLVZZiQtS

if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<MSG
Missing $ENV_FILE

It is written by ops/deploy-devnet.sh when the program is deployed
(see docs/PARCEL_CHAIN.md, "Devnet"), and lives only on the machine
that holds the devnet keys in ~/.parcel-devnet. Copy that directory
from the deploying machine or its backup; do not recreate it by hand.
Without it, run the sandbox instead: npm run demo:sandbox
MSG
  exit 1
fi

# Load quietly: the RPC URL carries an API key, so no value is printed.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export PORT

for v in SOLANA_RPC_URL PARCEL_PROGRAM_ID STRATA_STATE_DIR; do
  if [ -z "${!v:-}" ]; then
    echo "$ENV_FILE does not set $v; it is incomplete." >&2
    exit 1
  fi
done

. "$ROOT/scripts/demo-lib.sh"
free_port "$PORT"

echo "Building the desk..."
npm run build

echo "Checking the operator's devnet SOL..."
OPERATOR="$OPERATOR" node -e '
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const url = process.env.SOLANA_RPC_URL;
const scrub = (m) => String(m).split(url).join("<rpc>");
const timer = setTimeout(() => {
  console.log("  Could not read the balance (RPC timed out). Starting anyway.");
  process.exit(0);
}, 15000);
new Connection(url, "confirmed")
  .getBalance(new PublicKey(process.env.OPERATOR))
  .then((lamports) => {
    clearTimeout(timer);
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log(`  Operator ${process.env.OPERATOR}: ${sol.toFixed(3)} SOL`);
    if (sol < 1) {
      console.log("  WARNING: under 1 SOL. Each new onchain session holds about 0.33 SOL.");
      console.log("  Send devnet SOL to the operator address above (Phantom on devnet, or https://faucet.solana.com).");
    }
  })
  .catch((e) => {
    clearTimeout(timer);
    console.log("  Could not read the balance: " + scrub(e && e.message ? e.message : e));
    console.log("  Starting anyway.");
  });
'

echo
echo "Starting Parcel on Solana devnet. Ctrl+C to stop."
echo "Open http://localhost:$PORT"
echo
exec npx tsx server/index.ts
