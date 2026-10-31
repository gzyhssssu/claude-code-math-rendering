// Entirely synthetic test data. No Claude application code or real cache data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

export const URL = 'https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/ce044ea01-TEST.js';
export const SOURCE = 'var c=60,l=1024;function S(e,t,n,r){return n-t>r?null:e.slice(t,n)}function R(e,t,n,r){if(r-n>l)return!1;let o=S(e,n,r,c);return o!==null&&o.length>0}var Q={inlineGuard:R};export{Q as n};';
export function compressed(source = SOURCE, capacity = 1024) {
  const body = zlib.zstdCompressSync(Buffer.from(source));
  const pad = Buffer.alloc(capacity - body.length);
  pad.writeUInt32LE(0x184d2a50, 0); pad.writeUInt32LE(pad.length - 8, 4);
  return Buffer.concat([body, pad]);
}
export function header(size, count) {
  const b = Buffer.alloc(8192 + size * count);
  b.writeUInt32LE(0xc104cac3, 0); b.writeUInt32LE(0x20000, 4);
  b.writeInt32LE(size, 12); b.writeInt32LE(count, 20);
  for (let i = 0; i < count; i++) b[80 + (i >>> 3)] |= 1 << (i & 7);
  return b;
}
export function simple(key, tail = '') {
  const h = Buffer.alloc(24); h.writeBigUInt64LE(0xfcfb6d1ba7725c30n); h.writeUInt32LE(5, 8); h.writeUInt32LE(Buffer.byteLength(key), 12);
  return Buffer.concat([h, Buffer.from(key), Buffer.from(tail)]);
}
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-math-test-'));
  const profile = path.join(root, 'profile'), directory = path.join(profile, 'Cache', 'Cache_Data');
  const code = path.join(profile, 'Code Cache', 'js'), state = path.join(root, 'state');
  fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(code, { recursive: true });
  const original = compressed();
  const entries = header(256, 4), bodies = header(1024, 4);
  const offset = 8192;
  const key = '1/0/' + URL;
  entries.writeInt32LE(Buffer.byteLength(key), offset + 32);
  entries.writeInt32LE(original.length, offset + 44);
  entries.writeUInt32LE(0xb0020000, offset + 60);
  entries.write(key, offset + 96);
  original.copy(bodies, 8192);
  fs.writeFileSync(path.join(directory, 'data_1'), entries);
  fs.writeFileSync(path.join(directory, 'data_2'), bodies);
  fs.writeFileSync(path.join(code, 'abcdef01_0'), simple('_key' + URL + ' \nhttps://claude.ai/', 'compiled guard'));
  fs.writeFileSync(path.join(code, 'abcdef02_0'), simple('_keyhttps://example.invalid/other.js', URL));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, profile, directory, code, state, original, offset, entries, stopped: () => {} };
}
