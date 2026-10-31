import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Cache, sha, bytecodeFiles, isGuardURL } from '../src/cache.js';
import { fixture, URL } from './fixture.js';

test('finds allocated entries and reads exactly their body', t => {
  const f = fixture(t), cache = new Cache(f.profile);
  const entries = cache.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, URL);
  assert.deepEqual(cache.read(entries[0].location), f.original);
});
test('does not treat unallocated or evicted entries as active', t => {
  const f = fixture(t), file = path.join(f.directory, 'data_1');
  const bytes = fs.readFileSync(file); bytes[80] &= ~1; fs.writeFileSync(file, bytes);
  assert.equal(new Cache(f.profile).entries().length, 0);
  bytes[80] |= 1; bytes.writeInt32LE(1, 8192 + 20); fs.writeFileSync(file, bytes);
  assert.equal(new Cache(f.profile).entries().length, 0);
});
test('rejects pointers to free blocks, invalid blocks, and invalid headers', t => {
  const f = fixture(t), file = path.join(f.directory, 'data_2');
  const bytes = fs.readFileSync(file); bytes[80] &= ~1; fs.writeFileSync(file, bytes);
  const cache = new Cache(f.profile);
  assert.match(cache.entries()[0].error, /free cache block/);
  assert.throws(() => cache.locate(0x20000000, 100), /address/);
  bytes.writeUInt32LE(123, 0); fs.writeFileSync(file, bytes);
  assert.throws(() => cache.entries(), /header/);
});
test('refuses a stale entry or changed body instead of overwriting', t => {
  const f = fixture(t), cache = new Cache(f.profile), entry = cache.entries()[0];
  const file = path.join(f.directory, 'data_2');
  const bytes = fs.readFileSync(file); bytes[8192] ^= 1; fs.writeFileSync(file, bytes);
  assert.throws(() => cache.write(entry, f.original, sha(f.original)), /changed/);
  assert.equal(fs.readFileSync(file)[8192], bytes[8192]);
});
test('matches the compiled cache key, not an import string in bytecode', t => {
  const f = fixture(t);
  assert.deepEqual(bytecodeFiles(f.profile, new Set([URL])).map(item => item.name), ['abcdef01_0']);
});
test('asset URL restriction excludes lookalike hosts, query strings, and other assets', () => {
  assert.equal(isGuardURL(URL), true);
  for (const url of [URL + '?x=1', URL.replace('anthropic.com/', 'anthropic.com.evil/'), URL.replace('ce044ea01-', 'other-')]) assert.equal(isGuardURL(url), false);
});
test('range reads reject path traversal', t => {
  const f = fixture(t), cache = new Cache(f.profile);
  assert.throws(() => cache.read({ file: '../data_1', offset: 0, size: 10 }), /filename/);
});
test('writes reject a location that disagrees with the entry pointer', t => {
  const f = fixture(t), cache = new Cache(f.profile), entry = cache.entries()[0];
  const forged = { ...entry, location: { ...entry.location, offset: entry.location.offset + 1024 } };
  assert.throws(() => cache.write(forged, f.original, sha(f.original)), /location changed/);
});
