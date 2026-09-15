# Demo walkthrough

The included `strata-demo.mp4` is a narrated recording of the actual browser UI, backend practice ledger and Solana local-validator contract. Run the app on the private VPS for a live walkthrough. No wallet installation is needed.

1. Open Portfolio. The fixed practice reference holding is 100 NVDA shares; cash starts at $10,000. Prices are retained historical provider closes.
2. Build the default 100-share $120/$140 put spread, illustrative premium $400. Show the payoff curve and bounded protection.
3. Open “Try this contract on Solana.” Fund the $2,000 maximum payout and accept as the holder. Point out the actual network, session-specific wallets and escrow. The clock counts **Solana chain seconds**.
4. While that contract matures, close the dialog and complete the practice flow: Request → Maker → Fund → Review → Accept.
5. Advance to expiry. Toggle missing data and attempt settlement: funds remain locked. Restore the observation and retry against the stored $118.42 close.
6. Claim $2,000 as holder and $0 as maker. Both claims close the practice contract. Cash plus escrow conserves $60,000 across the two practice parties.
7. Show Replay: stock loss $2,420, hedge net gain $1,600, combined loss $820. Below the lower strike, additional stock losses resume. Adjust the basis slider to show residual token-price risk.
8. Return to the real Solana contract after its chain clock reaches expiry. Settle, claim as holder and maker, and show Closed / zero escrow. Open transaction proof links.
9. Financing remains read-only discovery; stock lending is a preview. State explicitly that this demo uses a trusted historical oracle and no-value test tokens. Devnet funding and public publication are pending.

## Reset and recover

Demo wallet → Export saves the current practice book. Reset creates a fresh practice book in the same backend session; it does not erase on-chain contracts. Reload resumes the saved portfolio and most recent session-owned chain contract. A pending chain request is safely reconciled by polling the same signed transaction.

## Re-record

On the Mac, install Playwright Chromium, use macOS `say`, and provide an ffmpeg executable:

```sh
STRATA_URL="http://$(~/bin/vps ip --ts):3025" \
FFMPEG=/path/to/ffmpeg \
node scripts/record-demo.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing compatible headless Chromium installation. The script asserts the practice and real-chain final states, records actual screen output, generates narration, and writes UI chain evidence. Only dedicated test tokens move.
