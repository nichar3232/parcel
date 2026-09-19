import { execFileSync } from 'node:child_process';

// Inspect the Git index: this is the content a commit or CI checkout will use.
const stagedOnly = process.argv.includes('--staged');
const args = stagedOnly
  ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']
  : ['ls-files', '-z'];
const files = execFileSync('git', args).toString().split('\0').filter(Boolean);
const findings = [];
const pinnedGenesis = [
  ['mainnet', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'],
  ['devnet', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'],
];
const credentials = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'GitHub credential',
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  ['API credential', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Telegram token', /\b\d{8,10}:[A-Za-z0-9_-]{32,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  [
    'assigned credential',
    /\b(?:api_key|secret|password|token)\s*[=:]\s*['"][A-Za-z0-9_-]{24,}['"]/i,
  ],
];
for (const file of files) {
  const segments = file.split('/');
  const name = segments.at(-1);
  if (
    segments.some((part) =>
      [
        '.state',
        'node_modules',
        'target',
        'dist',
        'test-results',
        'playwright-report',
      ].includes(part),
    ) ||
    (name.startsWith('.env') && name !== '.env.example') ||
    /(?:-keypair\.json|\.(?:pem|key|p12|pfx|seed|sqlite(?:-\w+)?|db(?:-\w+)?))$/.test(
      name,
    ) ||
    [
      'deployer.json',
      'maker.json',
      'holder.json',
      'program.json',
      'parcel-devnet-program.json',
    ].includes(name)
  )
    findings.push(`${file}: runtime, generated or signing material`);
  const data = execFileSync('git', ['show', `:${file}`], {
    maxBuffer: 20 * 1024 * 1024,
  });
  if (data.includes(0)) continue;
  const content = data.toString('utf8');
  for (const [label, pattern] of credentials) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
  /* A genesis hash truncated to its first 32 characters can never equal a
     real one, so every guard written against it silently passes whatever
     it was meant to refuse. That shipped in four files at once, across
     three languages, and mainnet was the thing being refused. */
  for (const [cluster, hash] of pinnedGenesis) {
    const prefix = hash.slice(0, 32);
    if (content.includes(prefix) && !content.includes(hash))
      findings.push(
        `${file}: truncated ${cluster} genesis hash; use the whole ${hash}`,
      );
  }
  if (file.endsWith('.json')) {
    try {
      const value = JSON.parse(content);
      if (
        Array.isArray(value) &&
        value.length === 64 &&
        value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      )
        findings.push(`${file}: possible Solana secret key array`);
    } catch {
      /* Some tooling accepts JSON with comments; it is not key material. */
    }
  }
}
if (findings.length) {
  console.error(
    'Repository check failed (values redacted):\n' + findings.join('\n'),
  );
  process.exit(1);
}
console.log(
  `Repository check passed: ${files.length} indexed files; no credential patterns or runtime files found.`,
);
