import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Cache } from '../src/cache.js';
import { install, inspect, restore } from '../src/service.js';
import { fixture, simple, URL } from './fixture.js';

test('installation is reversible, idempotent, and preserves cache metadata', t => {
  const f = fixture(t), beforeMetadata = fs.readFileSync(path.join(f.directory, 'data_1'));
  const result = install(f.profile, f.state, { assertStopped: f.stopped });
  assert.equal(result.changed, 1);
  assert.equal(inspect(f.profile).patched.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'data_1')), beforeMetadata);
  assert.equal(fs.existsSync(path.join(f.code, f.targetName)), false);
  assert.equal(fs.existsSync(path.join(f.code, 'abcdef02_0')), true);
  assert.equal(install(f.profile, f.state, { assertStopped: f.stopped }).changed, 0);
  fs.writeFileSync(path.join(f.code, f.targetName), simple(f.targetKey, 'new compiled patch'));
  assert.equal(restore(f.profile, f.state, { assertStopped: f.stopped }).restored, 1);
  assert.equal(fs.existsSync(path.join(f.code, f.targetName)), false);
  const cache = new Cache(f.profile);
  assert.deepEqual(cache.read(cache.entries()[0].location), f.original);
});
test('refuses running application before touching cache or making backups', t => {
  const f = fixture(t);
  assert.throws(() => install(f.profile, f.state, { assertStopped: () => { throw new Error('running'); } }), /running/);
  assert.equal(fs.existsSync(f.state), false);
});
test('a failure after writing triggers recovery from journaled original bytes', t => {
  const f = fixture(t); let failed = false;
  class FailingCache extends Cache {
    write(...args) { super.write(...args); if (!failed) { failed = true; throw new Error('simulated disk error'); } }
  }
  assert.throws(() => install(f.profile, f.state, { assertStopped: f.stopped, createCache: p => new FailingCache(p) }), /Original bytes restored/);
  const cache = new Cache(f.profile);
  assert.deepEqual(cache.read(cache.entries()[0].location), f.original);
});
test('rollback does not overwrite a reused body range', t => {
  const f = fixture(t); install(f.profile, f.state, { assertStopped: f.stopped });
  const file = path.join(f.directory, 'data_2'), bytes = fs.readFileSync(file);
  bytes.fill(0x77, 8192, 8192 + f.original.length); fs.writeFileSync(file, bytes);
  assert.equal(restore(f.profile, f.state, { assertStopped: f.stopped }).restored, 0);
  assert.deepEqual(fs.readFileSync(file), bytes);
});
test('restore finds relocated entries rather than writing stale offsets', t => {
  const f = fixture(t); install(f.profile, f.state, { assertStopped: f.stopped });
  const file = path.join(f.directory, 'data_2'), bytes = fs.readFileSync(file);
  bytes.copy(bytes, 8192 + 1024, 8192, 8192 + f.original.length); bytes.fill(55, 8192, 8192 + f.original.length);
  fs.writeFileSync(file, bytes);
  const recordsFile = path.join(f.directory, 'data_1'), records = fs.readFileSync(recordsFile);
  records.writeUInt32LE(0xb0020001, 8192 + 60); fs.writeFileSync(recordsFile, records);
  assert.equal(restore(f.profile, f.state, { assertStopped: f.stopped }).restored, 1);
  assert.deepEqual(fs.readFileSync(file).subarray(8192 + 1024, 8192 + 1024 + f.original.length), f.original);
  assert.equal(fs.readFileSync(file)[8192], 55);
});
test('tampered backup is rejected and wrong profile cannot be restored', t => {
  const f = fixture(t), other = fixture(t); const result = install(f.profile, f.state, { assertStopped: f.stopped });
  assert.throws(() => restore(other.profile, f.state, { assertStopped: f.stopped }), /different profile/);
  const file = path.join(f.state, 'backups', result.backup, '0.before.zst');
  fs.writeFileSync(file, Buffer.from('corrupt'));
  assert.throws(() => restore(f.profile, f.state, { assertStopped: f.stopped }), /integrity/);
});
test('backup path traversal and state directory inside profile are rejected', t => {
  const f = fixture(t);
  assert.throws(() => restore(f.profile, f.state, { assertStopped: f.stopped, backupId: '../elsewhere' }), /Invalid backup/);
  assert.throws(() => install(f.profile, path.join(f.profile, 'state'), { assertStopped: f.stopped }), /outside/);
});
