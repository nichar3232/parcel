'use strict';
// Small compatibility boundary for SPL's fixed-width integer layouts.
// No native addon is loaded. Invalid widths and overflowing integers fail closed.
function checkedBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024) throw new RangeError('Expected at most 1024 bytes');
  return bytes;
}
function toBigIntBE(bytes) {
  let value = 0n;
  for (const byte of checkedBytes(bytes)) value = (value << 8n) | BigInt(byte);
  return value;
}
function toBigIntLE(bytes) {
  checkedBytes(bytes);
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}
function toBufferLE(value, width) {
  if (typeof value !== 'bigint' || !Number.isInteger(width) || width < 0 || width > 1024 || value < 0n || value >= (1n << BigInt(width * 8))) throw new RangeError('Unsigned integer does not fit the requested width');
  const bytes = Buffer.alloc(width);
  for (let i = 0; i < width; i++) { bytes[i] = Number(value & 255n); value >>= 8n; }
  return bytes;
}
function toBufferBE(value, width) { return toBufferLE(value, width).reverse(); }
module.exports = {toBigIntBE, toBigIntLE, toBufferBE, toBufferLE};
