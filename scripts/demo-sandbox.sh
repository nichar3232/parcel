#!/usr/bin/env bash
# Start the Parcel desk in the keyless sandbox: `npm run demo:sandbox`.
# No chain, state in .state. Frees the port, builds, then runs the server
# in the foreground. Ctrl+C stops it. PORT overrides 3025.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PORT=${PORT:-3025}

# Drop any devnet settings left in this shell so nothing reaches the chain.
unset SOLANA_RPC_URL SOLANA_NETWORK SOLANA_GENESIS_HASH PARCEL_CHAIN_ENABLED \
  PARCEL_PROGRAM_ID PARCEL_CASH_MINT PARCEL_STOCK_MINT STRATA_AUTHORITY
export PORT CHAIN_ENABLED=false PARCEL_DEMO=1 STRATA_STATE_DIR=.state

. "$ROOT/scripts/demo-lib.sh"
free_port "$PORT"

echo "Building the desk..."
npm run build

echo
echo "Starting Parcel in the sandbox (no chain). Ctrl+C to stop."
echo "Open http://localhost:$PORT"
echo
exec npx tsx server/index.ts
