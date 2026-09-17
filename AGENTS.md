# Parcel project instructions

This repository contains Parcel, a granular options and collateral-vault workspace, plus the retained Strata Solana desk at `/legacy`. The new vault has an explicit persistent sandbox mode and an optional Parcel local-validator program with SPL test-token custody. Never describe sandbox results as onchain, or local-validator results as devnet/mainnet. Read `README.md`, `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` before changing runtime boundaries.

- Preserve same-origin frontend/API integration, server-authoritative accounting, session ownership and durable signed-transaction recovery.
- Validate with `npm run check:repo`, `npm run check` and the relevant browser journeys. Never label simulated or local-validator evidence as devnet or mainnet.
- Runtime state and signing keys do not belong in Git. The repository hygiene check must pass; do not bypass it.
- Always-on services belong on `trading-01`, reached through its SSH alias. Read `~/Brain/Infra/vps.md` and run `~/bin/vps free` before adding a tenant. Never hardcode a VPS address.
- Keep the existing service names, persistent data and validator ledger intact during app deployments. Do not reset the shared validator.
- Never push, publish or open a PR without explicit user authorization. The original setup push does not authorize unrelated future pushes.
