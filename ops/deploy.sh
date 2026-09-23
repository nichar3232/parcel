#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit operator command: updates only the private Stocklana tenant.
test -f dist/client/index.html
release="$(date -u +%Y%m%dT%H%M%SZ)"
target="/opt/stocklana/releases/$release"
ssh trading-01 "sudo install -d -o stocklana -g stocklana '$target'"
rsync -a --rsync-path='sudo rsync' --exclude=node_modules --exclude=.state --exclude=.git --exclude='.env*' --exclude=target --exclude=test-results --exclude=playwright-report --exclude='submission/*-source.zip' --exclude='dist/server' --exclude='dist/.vite' ./ "trading-01:$target/"
ssh trading-01 "sudo chown -R stocklana:stocklana '$target'; cd '$target'; sudo -u stocklana npm ci --ignore-scripts --no-audit --no-fund"
ssh trading-01 "sudo python3 - '$target' '$release'" <<'PY'
import json,os,pathlib,subprocess,sys,urllib.request
release,stamp=sys.argv[1:]
env=pathlib.Path('/opt/stocklana/.env')
lines=env.read_text().splitlines();values=dict(line.split('=',1) for line in lines if '=' in line and not line.startswith('#'))
# Existing validator only. No ledger reset, firewall change, or new external service.
rpc=values.get('SOLANA_RPC_URL','http://127.0.0.1:8899')
req=urllib.request.Request(rpc,data=b'{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}',headers={'Content-Type':'application/json'})
genesis=json.load(urllib.request.urlopen(req,timeout=15))['result']
# Whole 32-byte hash. The 32-character prefix this used to compare against
# never equalled a real genesis, so the refusal never fired.
if genesis=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':raise SystemExit('Refusing mainnet.')
values.setdefault('SOLANA_NETWORK','localnet')
values.setdefault('SOLANA_GENESIS_HASH',genesis)
if values['SOLANA_GENESIS_HASH']!=genesis:raise SystemExit('Pinned chain identity changed. Investigate before deploying.')
values['NODE_ENV']='production'
tmp=env.with_suffix('.env.tmp');tmp.write_text('\n'.join(f'{k}={v}' for k,v in values.items())+'\n');os.chmod(tmp,0o600);subprocess.run(['chown','stocklana:stocklana',str(tmp)],check=True);os.replace(tmp,env)
app=pathlib.Path('/opt/stocklana/app')
previous=str(app.resolve()) if app.is_symlink() else f'/opt/stocklana/releases/before-{stamp}'
subprocess.run(['systemctl','stop','stocklana-web'],check=True)
if app.is_symlink():app.unlink()
else:app.rename(previous)
os.symlink(release,app)
subprocess.run(['install','-m','644',release+'/ops/stocklana-web.service','/etc/systemd/system/stocklana-web.service'],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','restart','stocklana-web'],check=True)
pathlib.Path('/opt/stocklana/previous-release').write_text(previous+'\n')
print('Release installed:',release,'Previous:',previous)
PY
for attempt in 1 2 3 4 5; do
 if ssh trading-01 'curl --fail --silent http://127.0.0.1:3025/api/ready'; then
  printf '\nPrivate deployment is ready.\n'; exit 0
 fi
 sleep 2
done
printf '\nReadiness failed. Previous release is recorded in /opt/stocklana/previous-release. See ops/README.md for rollback.\n' >&2
exit 1
