#!/usr/bin/env bash
# Every gate this project has, in one command, with a verdict per gate.
#
# The point is that it does not depend on anybody's summary: each line
# either ran and passed or it did not, and the exit code is the answer.
# Chain gates are skipped loudly when the environment is not configured,
# because a skipped check is not a passed one.
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
declare -a results

run() {
  local name=$1; shift
  printf '\n\033[1m== %s\033[0m\n' "$name"
  if "$@"; then
    results+=("PASS  $name")
  else
    results+=("FAIL  $name")
    fails=$((fails + 1))
  fi
}

skip() { results+=("SKIP  $1 — $2"); printf '\n\033[1m== %s\033[0m\n(skipped: %s)\n' "$1" "$2"; }

run "repository (secrets, runtime files, truncated genesis)" npm run --silent check:repo
run "typecheck"        npx tsc --noEmit
run "lint"             npm run --silent lint
run "unit tests"       npm test
run "build"            npm run --silent build
run "browser journeys" npm run --silent test:e2e

# The chain gates need a provisioned ledger; without one they are skipped,
# never silently counted as passing.
if [ "${PARCEL_CHAIN_ENABLED:-false}" = "true" ]; then
  run "program: chain lifecycle"    npx tsx scripts/verify-parcel-chain.ts
  run "program: adversarial reject" npx tsx scripts/verify-parcel-adversarial.ts
else
  skip "program: chain lifecycle"    "PARCEL_CHAIN_ENABLED is not true"
  skip "program: adversarial reject" "PARCEL_CHAIN_ENABLED is not true"
fi

if command -v cargo-build-sbf >/dev/null 2>&1 || [ -d programs/parcel ]; then
  if (cd programs/parcel && cargo +stable test --lib >/dev/null 2>&1); then
    results+=("PASS  program: rust tests")
  else
    results+=("SKIP  program: rust tests — no rust toolchain here (build on trading-01)")
  fi
fi

printf '\n\033[1m================ verdict ================\033[0m\n'
for line in "${results[@]}"; do printf '%s\n' "$line"; done
printf '\n'
if [ "$fails" -gt 0 ]; then
  printf '\033[31m%d gate(s) failed.\033[0m\n' "$fails"
  exit 1
fi
printf '\033[32mEvery gate that ran, passed. Note any SKIP above.\033[0m\n'
