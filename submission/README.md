# Submission materials

| Material | Purpose |
|---|---|
| [ENTRY.md](ENTRY.md) | Submission narrative and current publication gates |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Walkthrough and explanation |
| [strata-demo.mp4](strata-demo.mp4) | Actual narrated UI/backend/Solana recording |
| [VALIDATION.md](VALIDATION.md) | Test results and honest execution boundaries |
| `chain-evidence.json` | Adversarial program verification |
| `backend-chain-evidence.json` | Three scenarios through the real backend |
| `ui-chain-evidence.json` | Recorded UI execution and claims |
| `transaction-proofs/` | Inspectable confirmed transaction records |

The project repository is **Bellwether**; the existing audited desk and recording use **Strata**. Evidence is from an isolated Solana validator. Devnet funding and public access remain submission gates.

Run `python3 scripts/package-submission.py` from the repository to generate `strata-source.zip`, `source-manifest.json` and `SHA256SUMS`. Generated archives are ignored in Git to avoid storing a second copy of the source. The video, original product document, dataset and verification evidence remain tracked.
