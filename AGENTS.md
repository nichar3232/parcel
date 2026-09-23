# Parcel project instructions

This repository contains Parcel, a granular options and collateral-vault workspace, plus the retained Strata Solana desk at `/legacy`. The new vault has an explicit persistent sandbox mode and an optional Parcel local-validator program with SPL test-token custody. Never describe sandbox results as onchain, or local-validator results as devnet/mainnet. Read `README.md`, `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` before changing runtime boundaries.

- Preserve same-origin frontend/API integration, server-authoritative accounting, session ownership and durable signed-transaction recovery.
- Validate with `npm run check:repo`, `npm run check` and the relevant browser journeys. Never label simulated or local-validator evidence as devnet or mainnet.
- Runtime state and signing keys do not belong in Git. The repository hygiene check must pass; do not bypass it.
- There is no always-on host: `trading-01` was destroyed on 2026-09-23 (see `~/Brain/Infra/vps.md`). Do not propose or add new hosting without asking. Chain keys live outside the repository in `~/.parcel-devnet/keys`.
- Never delete or overwrite `~/.parcel-devnet`; it holds the only devnet operator key and the devnet state directory.
- Never push, publish or open a PR without explicit user authorization. The original setup push does not authorize unrelated future pushes.
