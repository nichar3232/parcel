# Parcel private VPS operations

Read `~/Brain/Infra/vps.md` and run `~/bin/vps free` before adding capacity. This tenant already runs on `trading-01`. Resolve its address with `~/bin/vps ip --ts`; never hardcode the address. The existing firewall makes port 3025 tailnet-only. Solana RPC binds loopback 8899. No Mac process is needed after deployment.

## Files and services

- `/opt/stocklana/app`: current release (symlink after audited deployment)
- `/opt/stocklana/releases/`: immutable source/build releases and previous version
- `/opt/stocklana/.env`: service configuration, owner stocklana, mode 600
- `/var/lib/stocklana/strata.sqlite`: durable portfolio/session/chain operation state; WAL/SHM companions
- `/var/lib/stocklana/deployer.json`: dedicated no-value test authority, mode 600
- `/var/lib/stocklana/localnet-mint.json`: test mint identity
- `/var/lib/stocklana/proofs/`, `evidence.json`: chain evidence
- `/var/lib/stocklana/ledger/`: existing validator ledger; never reset as part of an app deploy
- `stocklana-web`: Node 22 + tsx, Restart=always, 512 MB cap, 100% CPU
- `stocklana-validator`: existing 2 GB / 150% CPU cap

The old JSON interactive sessions are retained as legacy evidence. New browser sessions never inherit the earlier shared wallets. Browser-only practice balances are not imported because they were user-editable.

Required chain environment:

```dotenv
PORT=3025
NODE_ENV=production
STRATA_STATE_DIR=/var/lib/stocklana
STRATA_PUBLIC_DIR=/opt/stocklana/app/dist/client
SOLANA_NETWORK=localnet
SOLANA_RPC_URL=http://127.0.0.1:8899
SOLANA_GENESIS_HASH=<actual existing validator genesis>
REPLAY_EXPIRY_SECONDS=90
```

The genesis pin is discovered once from the existing validator and then checked. An unexpected change must be investigated; never automatically replace a nonempty pin. For HTTPS, also set `COOKIE_SECURE=true`. Keep the service private until public hosting has been explicitly approved and provisioned.

## Deploy and inspect

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
./ops/deploy.sh
ssh trading-01 'curl --fail --silent http://127.0.0.1:3025/api/ready'
~/bin/vps logs stocklana-web
```

The deploy script installs dependencies in a new release, keeps the previous release, swaps only this app, and restarts only `stocklana-web`. It never resets the validator or opens the firewall. `vendor/bigint-buffer` must ship with package.json/lockfile. Linux optional esbuild binaries are required by tsx: do not use `--omit=optional`. `--ignore-scripts` is supported and verified.

Rollback: stop `stocklana-web`, read `/opt/stocklana/previous-release`, replace `/opt/stocklana/app` with a symlink to that directory, and restart. If rolling back to the pre-audit JavaScript server, also restore its `server/index.mjs` ExecStart from that release's service unit. The new SQLite state remains intact. Do not overwrite the database with an old copy merely to roll back code.

## Recovery and backup

Refresh an interrupted contract in the UI. The pending signed transaction is persisted and reconciled; retrying cannot create a second transfer. A request that has definitively expired can be submitted with a new key. Never delete pending operations to force a retry.

Create a consistent online SQLite backup using Node's backup API:

```sh
ssh trading-01 'cd /opt/stocklana/app && sudo -u stocklana env STRATA_STATE_DIR=/var/lib/stocklana node ops/backup.mjs'
```

Backups are mode 600 under `/var/lib/stocklana/backups`. This protects against an accidental database edit; it is not an offsite disaster-recovery solution. Keep keys and ledger in a separately protected operator backup before moving hosts. Secrets are never included in the submission archive.

## Verify actual Solana execution

```sh
ssh trading-01
cd /opt/stocklana/app
sudo -u stocklana bash -c 'set -a; . /opt/stocklana/.env; set +a; node --import tsx scripts/audit-chain.ts'
sudo -u stocklana bash -c 'set -a; . /opt/stocklana/.env; set +a; node scripts/verify-contract.mjs'
```

The first command uses a separate `audit.sqlite`, the real HTTP/domain/adapter code, and three contracts. It writes `audit-interactive-evidence.json`. The second is the lower-level adversarial verifier and updates `evidence.json`. Both mint and move only dedicated test tokens. Do not run the original shared-wallet verifier from a public request handler.

## Program build and devnet gate

The source is Anchor 0.32.1. The VPS toolchain lives under `/opt/stocklana/tooling/{cargo,rustup,solana-release}`. Add its cargo/bin and solana-release/bin to PATH and set CARGO_HOME/RUSTUP_HOME accordingly before `cargo test --lib` or `cargo build-sbf` in `programs/strata`.

The validator unit references the retained `artifacts/strata-localnet.so`, which ships with every release; it must not reference an excluded Cargo `target/` directory. Changing the unit file does not require resetting the ledger.

The existing local validator preloads its program with the system address as upgrade authority. The demo authority cannot upgrade it. Do not reset the ledger or attempt to overwrite that program during an application deployment. `artifacts/strata-localnet.so` preserves the tested executable; `artifacts/strata.so` is the freshly rebuilt, logically unchanged source. See `docs/audit/program-build.json`.

Public program and authority constants are in `programs/strata/src/lib.rs` and backend config. Independent deployments require their own dedicated test keys and a matching rebuilt program. Existing keys stay on the box.

The current authority has not been funded on devnet; prior faucet requests were rate-limited. Devnet is not claimed complete. Once **test SOL** is available, deploy to devnet using the dedicated program key, bootstrap a six-decimal test mint with the verifier, pin the official devnet genesis, and repeat all chain tests before switching the service. Never use real funds or relabel local-validator evidence as devnet evidence.

## Parcel cutover

Parcel replaces the UI at `/` and retains the previous desk at `/legacy`. Keep the established `stocklana-web` and `stocklana-validator` service names, state directory and ledger. The extra SQLite migration adds vault tables without changing old positions. The new vault runs as backend test accounting and uses separate balances from original onchain contracts. App rollback preserves all database tables. Do not reset the validator or reinterpret backend vault balances as onchain token accounts.

## Parcel release review (not promoted)

The current release review is under `/var/lib/stocklana/parcel-review` on `trading-01`. It uses a new program deployed additively to the existing private validator. The declared program ID and its test-mint configuration are recorded in `docs/PARCEL_CHAIN.md` and the release evidence. Its private deployment key and temporary review environment stay on the box. The ordinary `stocklana-web` app and existing database have not been switched to this branch.

The review backend runs only for a bounded recording/check session on loopback port 3028, reached through a temporary SSH forward. It is not a new always-on tenant. Promoting this release requires the normal authorized deployment, backups and environment update; keep the existing service names and validator ledger. Future persistent operation still belongs in the existing `stocklana-web` systemd unit with `Restart=always`.
