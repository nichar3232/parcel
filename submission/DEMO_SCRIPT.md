# Parcel current-product walkthrough

Use the review build in configured Parcel localnet mode. Confirm the footer says **Solana local validator**. All assets and counterparties are test values.

1. Open Vault. Deposit 500 test USDC and 2 NVDA. These actions transfer SPL test tokens into the program's escrow.
2. Open Underwrite. Choose 0.333333 share-equivalents. Move the reference slider down 30%; the covered-call strategy loses money because its stock loss is included. Review every option leg, premium and available collateral, then confirm.
3. Open Trade. Show the physical long call's full strike-cash-plus-premium funding. Reduce quantity to 0.1 and confirm the fractional contract.
4. Open Structures. Review and execute a 0.25-share cash-settled call spread. Explain its bounded payoff and different funding model.
5. Open Lending. Lend 0.1 NVDA. Review sale proceeds, protective call and borrower escrow. Explain that the test borrower sells the stock; the market reserves protection shares.
6. Open Risk. Show shared-expiry offsets, available capital and separate counterparty reserves.
7. Advance Market controls to February 7, 2025. The program settles due contracts and repays the loan using the stored expiry observation. Open Activity and inspect the confirmed Parcel vault, revision, slot and transaction proof.
8. Advance to April 3 and show Restart historical replay. Receipts remain recorded and the next replay has usable expiries.

The closing statement must distinguish implemented local-validator custody from production readiness. No external market maker, issuer stock token or live oracle is connected. Fractional size changes dollar exposure, not percentage theta.

Recording: `PARCEL_URL=http://127.0.0.1:13028 npm run record:demo` on the Mac uses the actual UI and Samantha narration. `python3 scripts/encode-parcel.py .state/parcel-media submission/parcel-demo.mp4` muxes with ffmpeg. The encoder can run on the VPS; neither script publishes the result.
