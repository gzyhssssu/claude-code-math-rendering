import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { transform, encodeSameSize, decode, MAX_SOURCE_BYTES } from '../src/patcher.js';
import { SOURCE, compressed } from './fixture.js';

test('replaces length heuristics while preserving empty-content rejection', () => {
  const result = transform(SOURCE);
  assert.equal(result.changed, true);
  const evaluate = source => vm.runInNewContext(source.replace(/export\{[^}]+\};/, '') + ';Q.inlineGuard');
  const original = evaluate(SOURCE), patched = evaluate(result.source);
  for (const n of [60, 61, 1024, 1025, 10000]) {
    const text = 'x'.repeat(n);
    assert.equal(original(text, 0, 0, n), n <= 60);
    assert.equal(patched(text, 0, 0, n), true);
  }
  assert.equal(patched('', 0, 0, 0), false);
  assert.equal(transform(result.source).changed, false);
});
test('refuses unrelated constants and partially patched modules', () => {
  for (const source of ['var c=60,l=1024;', SOURCE.replace('inlineGuard:R', 'something:R'), SOURCE.replace('r-n>l', 'r-n>different'), SOURCE.replace('S(e,n,r,c)', 'S(e,n,r,other)'), SOURCE.replace('c=60', 'c=1/0')]) {
    assert.throws(() => transform(source));
  }
});
test('never executes cached code', () => {
  const source = SOURCE + 'for(;;){};globalThis.secret=1;';
  assert.equal(transform(source).changed, true);
  assert.equal(globalThis.secret, undefined);
});
test('syntax errors in the transformed module prevent installation', () => {
  assert.throws(() => transform(SOURCE + 'unclosed('), /syntax validation/);
});
test('recompression preserves length including a skippable frame', () => {
  const original = compressed();
  const source = transform(SOURCE).source;
  const patched = encodeSameSize(source, original);
  assert.equal(patched.length, original.length);
  assert.equal(decode(patched).toString(), source);
});
test('rejects impossible sizes and unexpected compression', () => {
  const tiny = Buffer.alloc(4); tiny.writeUInt32LE(0xfd2fb528);
  assert.throws(() => encodeSameSize(SOURCE, tiny), /cannot fit/);
  assert.throws(() => encodeSameSize(SOURCE, zlib.gzipSync(Buffer.from(SOURCE))), /Zstandard/);
  assert.throws(() => decode(Buffer.from('bad')));
});
test('bounds decompression and source lengths', () => {
  assert.throws(() => decode(zlib.zstdCompressSync(Buffer.alloc(MAX_SOURCE_BYTES + 1, 65))));
  assert.throws(() => transform(' '.repeat(MAX_SOURCE_BYTES + 1)));
});
