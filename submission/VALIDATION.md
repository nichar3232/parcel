# Current Parcel validation

The authoritative current-product report is [the release audit](../docs/audit/2026-09-15-release/REPORT.md).

| Layer | Result |
|---|---|
| Application | 65 passing tests; typecheck and lint pass |
| Browser | 25 passing real-backend journeys, including mobile and lost-response recovery |
| Native program | 6 Rust tests pass; SBPFv3 builds |
| Current Solana execution | 19 confirmed lifecycle actions; SPL escrow and backend projection match |
| Adversarial program inputs | 14 rejected cases, including a transaction signed by the owner alone and one signed by the operator alone; state remains unchanged |
| Onchain capacity | 64 four-leg contracts; withdraw all free cash and settle all 64 |
| Backend risk performance | 500 positions / 2,000 legs: 2.73 ms median, 4.88 ms p95 on the development Mac |
| UI demo | Current Parcel recording, narration, captions and confirmed vault proof |

The compiled binary is compared with the deployed program bytes. The evidence in this folder is labeled **private Solana local validator**: that is where the lifecycle, adversarial and capacity runs above were recorded.

The program is separately **deployed on Solana devnet** as [`FwEY5cM9vP31LwywoJu1XWQ1nvBeNh2aMsVVpbYayRvC`](https://explorer.solana.com/address/FwEY5cM9vP31LwywoJu1XWQ1nvBeNh2aMsVVpbYayRvC?cluster=devnet), built from this source under its own declared id and its own devnet operator, where the first vault deposit is [confirmed at slot 502867319](https://explorer.solana.com/tx/56o3DAiqEvjGYytJaNQtds4Lnp2KYSAgSsuAcyXVkpvm86FTN8QZaDmqV4iAKVFexKB3zkwR6KWCHjtMrum72CDw?cluster=devnet). The runs above **have been repeated on devnet** on 2026-09-23 against a dedicated RPC endpoint, and are recorded in [parcel-devnet-v2-chain-evidence.json](parcel-devnet-v2-chain-evidence.json) and [parcel-devnet-v2-adversarial.json](parcel-devnet-v2-adversarial.json); each names the cluster and pins its genesis. The first devnet deployment, `A4NTJ45BZT951nYh5xDXUKtyWij3YrYjcngyMigsq9pG`, passed the same runs on 2026-09-19 ([chain](parcel-devnet-chain-evidence.json), [adversarial](parcel-devnet-adversarial.json)); its operator key was lost with the host that held it, so it can no longer be driven. The public devnet endpoint rate limits below what a complete run needs, so a dedicated one is required to reproduce them. Nothing here is mainnet evidence, external liquidity, or a production audit. Older Strata proof files in this folder remain historical and are not used to establish current Parcel behavior.

Commands: `npm run check`, `npm run test:e2e`, `npm run check:repo`; configured onchain operators additionally run `npm run verify:parcel-chain` and `npm run verify:parcel-adversarial`. The capacity fixture uses `npm run verify:parcel-chain -- --capacity`.
