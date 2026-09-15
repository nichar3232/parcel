import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const codec = require('../vendor/bigint-buffer/index.cjs') as {
  toBigIntLE(b: Uint8Array): bigint;
  toBigIntBE(b: Uint8Array): bigint;
  toBufferLE(n: bigint, w: number): Buffer;
  toBufferBE(n: bigint, w: number): Buffer;
};
void test('SPL integer compatibility: independent Node 64-bit codec and wider boundaries', () => {
  for (let i = 0n; i < 1000n; i++) {
    const value = (i * 18446744073709551n) & ((1n << 64n) - 1n);
    const le = Buffer.alloc(8),
      be = Buffer.alloc(8);
    le.writeBigUInt64LE(value);
    be.writeBigUInt64BE(value);
    assert.deepEqual(codec.toBufferLE(value, 8), le);
    assert.deepEqual(codec.toBufferBE(value, 8), be);
    assert.equal(codec.toBigIntLE(le), value);
    assert.equal(codec.toBigIntBE(be), value);
  }
  for (const width of [0, 1, 8, 16, 32]) {
    const value = (1n << BigInt(width * 8)) - 1n;
    assert.equal(codec.toBigIntLE(codec.toBufferLE(value, width)), value);
    assert.equal(codec.toBigIntBE(codec.toBufferBE(value, width)), value);
  }
});
void test('SPL integer compatibility: allocation bounds, negative values and overflow fail closed', () => {
  assert.throws(() => codec.toBufferLE(-1n, 8), RangeError);
  assert.throws(() => codec.toBufferBE(256n, 1), RangeError);
  assert.throws(() => codec.toBufferLE(0n, 1.5), RangeError);
  assert.throws(() => codec.toBufferLE(0n, 1025), RangeError);
  assert.throws(() => codec.toBigIntLE(new Uint8Array(1025)), RangeError);
  assert.equal(codec.toBigIntLE(new Uint8Array(0)), 0n);
  assert.equal(codec.toBigIntBE(new Uint8Array(0)), 0n);
});
void test('historical settlement provenance matches retained source bytes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const data = JSON.parse(
    await readFile(new URL('../data/history.json', import.meta.url), 'utf8'),
  ) as { sha256: string; retrievedAt: string };
  const raw = await readFile(
    new URL('../data/nvda-yahoo-raw.json', import.meta.url),
  );
  const provenance = JSON.parse(
    await readFile(new URL('../data/provenance.json', import.meta.url), 'utf8'),
  ) as { sha256: string; retrievedAt: string };
  assert.equal(createHash('sha256').update(raw).digest('hex'), data.sha256);
  assert.equal(data.sha256, provenance.sha256);
  assert.equal(data.retrievedAt, provenance.retrievedAt);
});
