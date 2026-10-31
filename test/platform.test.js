import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverProfiles } from '../src/platform.js';
import { fixture } from './fixture.js';

test('discovers a Store profile without any hard-coded account name', t => {
  const f = fixture(t);
  const profile = path.join(f.root, 'local', 'Claude-Data', 'claude_test123');
  fs.mkdirSync(path.join(profile, 'Cache', 'Cache_Data'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Cache', 'Cache_Data', 'data_1'), 'fixture');
  assert.deepEqual(discoverProfiles({ LOCALAPPDATA: path.join(f.root, 'local') }), [{ path: profile, priority: 0 }]);
});
