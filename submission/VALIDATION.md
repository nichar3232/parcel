# Current Parcel validation

The authoritative current-product report is [the release audit](../docs/audit/2026-09-15-release/REPORT.md).

| Layer | Result |
|---|---|
| Application | 65 passing tests; typecheck and lint pass |
| Browser | 25 passing real-backend journeys, including mobile and lost-response recovery |
| Native program | 6 Rust tests pass; SBPFv3 builds |
| Current Solana execution | 19 confirmed lifecycle actions; SPL escrow and backend projection match |
| Adversarial program inputs | 9 rejected cases; state remains unchanged |
| Onchain capacity | 64 four-leg contracts; withdraw all free cash and settle all 64 |
| Backend risk performance | 500 positions / 2,000 legs: 2.73 ms median, 4.88 ms p95 on the development Mac |
| UI demo | Current Parcel recording, narration, captions and confirmed vault proof |

The compiled binary is compared with the deployed program bytes. Evidence is labeled **private Solana local validator**. It is not devnet/mainnet evidence, external liquidity, or a production audit. Older Strata proof files in this folder remain historical and are not used to establish current Parcel behavior.

Commands: `npm run check`, `npm run test:e2e`, `npm run check:repo`; configured localnet operators additionally run `npm run verify:parcel-chain` and `npm run verify:parcel-adversarial`. The capacity fixture uses `npm run verify:parcel-chain -- --capacity`.
