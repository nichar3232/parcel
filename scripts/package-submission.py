"""Package only the project; exclude state, keys, dependencies and build caches."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1]
roots={'.github','app','components','hooks','lib','server','programs','scripts','ops','vendor','data','docs','public','artifacts','tests','submission'}
files={'AGENTS.md','CONTRIBUTING.md','.gitattributes','README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','next.config.ts','next.config.mjs','postcss.config.mjs','playwright.config.ts','.gitignore','.nvmrc','.oxlintrc.json','.oxfmtrc.json','.env.example','components.json','next-env.d.ts','.openai/hosting.json'}
excluded={'node_modules','.state','.git','target','test-results','playwright-report','__pycache__'}
selected=[]
for file in root.rglob('*'):
 if not file.is_file():continue
 rel=file.relative_to(root)
 if any(part in excluded for part in rel.parts):continue
 if rel.parts[0] not in roots and str(rel) not in files:continue
 if file.name.endswith('-source.zip'):continue
 if file.name in {'parcel-source.zip','SHA256SUMS','source-manifest.json','.DS_Store'} or file.name.endswith('.tsbuildinfo'):continue
 if file.name.startswith('.env') and file.name!='.env.example':continue
 if file.name.endswith('-keypair.json') or file.name in {'deployer.json','maker.json','holder.json','program.json'}:raise RuntimeError(f'Private key filename in source: {rel}')
 selected.append(file)
selected.sort()
manifest={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in selected}
manifest_file=root/'submission/source-manifest.json';manifest_file.write_text(json.dumps(manifest,indent=2)+'\n')
archive=root/'submission/parcel-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as out:
 for file in selected+[manifest_file]:out.write(file,'parcel/'+str(file.relative_to(root)))
proofs=sorted((root/'submission/transaction-proofs').glob('*.json'))
checked=[root/'README.md',root/'package-lock.json',root/'data/nvda-yahoo-raw.json',root/'data/history.json',root/'artifacts/parcel-localnet.so',root/'docs/audit/2026-09-15-release/chain-lifecycle.json',root/'docs/audit/2026-09-15-release/chain-adversarial.json',root/'artifacts/strata.so',root/'artifacts/strata-localnet.so',root/'docs/audit/program-build.json',root/'docs/audit/REPORT.md',archive,manifest_file,*sorted((root/'submission').glob('*.json')),*sorted((root/'submission').glob('*.mp4')),*proofs]
checked=list(dict.fromkeys(checked))
(root/'submission/SHA256SUMS').write_text(''.join(f'{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(root)}\n' for f in checked))
print(f'Packaged {len(selected)+1} files; {archive.stat().st_size:,} bytes; no state or private-key files included.')
