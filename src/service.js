import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Cache, sha, within, safeFile, isAssetURL, bytecodeFiles } from './cache.js';
import { decode, transform, encodeSameSize } from './patcher.js';
import { assertStopped as windowsStopped } from './platform.js';

function save(file, value) {
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function locked(stateDir, operation) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, 'operation.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx'); }
  catch { throw new Error('Another operation holds the state lock. If no patcher is running, rename operation.lock and retry.'); }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  try { return operation(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
export function inspect(profile) {
  const cache = new Cache(profile);
  const supported = [], patched = [], skipped = [];
  for (const entry of cache.entries()) {
    if (entry.error) { skipped.push({ url: entry.url, reason: entry.error }); continue; }
    try {
      const original = cache.read(entry.location);
      const result = transform(decode(original).toString('utf8'), entry.kind);
      if (!result.changed) { patched.push({ url: entry.url, kind: entry.kind }); continue; }
      const replacement = encodeSameSize(result.source, original);
      supported.push({ entry, original, replacement });
    } catch (error) { skipped.push({ url: entry.url, reason: error.message }); }
  }
  return { cache, supported, patched, skipped };
}
export function summary(result) {
  return { profile: result.cache.profile, supported: result.supported.map(item => ({ url: item.entry.url, kind: item.entry.kind, bytes: item.original.length })), patched: result.patched, skipped: result.skipped };
}
function moveBytecode(profile, urls, directory, manifest, manifestFile) {
  fs.mkdirSync(directory, { recursive: true });
  for (const item of bytecodeFiles(profile, urls)) {
    const from = safeFile(item.directory, item.name);
    const destination = path.join(directory, item.name);
    const hash = sha(fs.readFileSync(from));
    if (fs.existsSync(destination)) throw new Error('Bytecode backup already exists.');
    // Journal the intended move before changing the source directory.
    manifest.bytecode.push({ name: item.name, sha256: hash, saved: path.relative(path.dirname(manifestFile), destination) });
    save(manifestFile, manifest);
    fs.renameSync(from, destination);
  }
}

export function install(profile, stateDir, { assertStopped = windowsStopped, createCache = p => new Cache(p) } = {}) {
  assertStopped();
  const state = path.resolve(stateDir);
  return locked(state, () => {
    const plan = inspect(profile);
    const cache = createCache(profile);
    if (within(cache.profile, state)) throw new Error('State/backup directory must be outside the Claude profile.');
    if (!plan.supported.length) {
      if (!plan.patched.length) throw new Error('No supported formula guard found. Run doctor for compatibility details.');
      return { success: true, changed: 0, alreadyPatched: plan.patched.length, skipped: plan.skipped };
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const directory = path.join(state, 'backups', id);
    fs.mkdirSync(directory, { recursive: true });
    const manifestFile = path.join(directory, 'manifest.json');
    const manifest = { format: 1, id, profile: cache.profile, status: 'preparing', createdAt: new Date().toISOString(), scripts: [], bytecode: [] };
    for (const [index, item] of plan.supported.entries()) {
      cache.verify(item.entry, sha(item.original));
      const before = `${index}.before.zst`, after = `${index}.after.zst`;
      fs.writeFileSync(path.join(directory, before), item.original, { flag: 'wx' });
      fs.writeFileSync(path.join(directory, after), item.replacement, { flag: 'wx' });
      manifest.scripts.push({ ...item.entry, before, after, beforeHash: sha(item.original), afterHash: sha(item.replacement) });
    }
    manifest.status = 'installing'; save(manifestFile, manifest);
    // Save the backup pointer before the first byte is changed, for crash recovery.
    save(path.join(state, 'latest.json'), { id });
    const attempted = [];
    try {
      assertStopped();
      for (const item of plan.supported) {
        attempted.push(item);
        cache.write(item.entry, item.replacement, sha(item.original));
      }
      moveBytecode(cache.profile, new Set(manifest.scripts.map(item => item.url)), path.join(directory, 'bytecode'), manifest, manifestFile);
      manifest.status = 'installed'; save(manifestFile, manifest);
    } catch (error) {
      let recoveryError;
      for (const item of attempted.reverse()) {
        try {
          const current = cache.read(item.entry.location);
          if (!current.every((byte, i) => byte === item.original[i] || byte === item.replacement[i])) throw new Error('Unexpected concurrent body change.');
          cache.write(item.entry, item.original, sha(current));
        } catch (cause) { recoveryError = cause; }
      }
      for (const item of manifest.bytecode) {
        const original = path.join(cache.profile, 'Code Cache', 'js', item.name);
        const saved = path.join(directory, item.saved);
        if (!fs.existsSync(original) && fs.existsSync(saved)) {
          if (!within(directory, saved) || sha(fs.readFileSync(saved)) !== item.sha256) { recoveryError = new Error('Bytecode backup changed.'); continue; }
          fs.renameSync(saved, original);
        }
      }
      manifest.status = recoveryError ? 'recovery-required' : 'rolled-back'; save(manifestFile, manifest);
      throw new Error(`${error.message} ${recoveryError ? `Recovery requires attention: ${recoveryError.message}; backup ${id}` : 'Original bytes restored.'}`);
    }
    return { success: true, changed: manifest.scripts.length, alreadyPatched: plan.patched.length, backup: id, skipped: plan.skipped };
  });
}

export function restore(profile, stateDir, { backupId, assertStopped = windowsStopped } = {}) {
  assertStopped();
  return locked(stateDir, () => {
    const id = backupId || JSON.parse(fs.readFileSync(path.join(stateDir, 'latest.json'), 'utf8')).id;
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid backup ID.');
    const directory = path.join(stateDir, 'backups', id);
    const manifestFile = safeFile(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const cache = new Cache(profile);
    if (manifest.format !== 1 || path.resolve(manifest.profile).toLowerCase() !== cache.profile.toLowerCase()) throw new Error('Backup belongs to a different profile or format.');
    const current = cache.entries();
    const restored = [], skipped = [], invalidate = new Set();
    assertStopped();
    for (const item of manifest.scripts) {
      if (!isAssetURL(item.url)) throw new Error('Backup contains an invalid asset URL.');
      const before = fs.readFileSync(safeFile(directory, item.before));
      const after = fs.readFileSync(safeFile(directory, item.after));
      if (sha(before) !== item.beforeHash || sha(after) !== item.afterHash || before.length !== after.length) throw new Error('Backup integrity check failed.');
      const candidates = current.filter(entry => entry.url === item.url && !entry.error);
      const entry = candidates.find(entry => entry.location.size === after.length && sha(cache.read(entry.location)) === item.afterHash);
      // Never use a stale offset: cache entries may have moved or been reused.
      if (!entry) {
        if (candidates.some(candidate => candidate.location.size === before.length && sha(cache.read(candidate.location)) === item.beforeHash)) invalidate.add(item.url);
        skipped.push({ url: item.url, reason: 'Resource was evicted, refetched, or already restored.' }); continue;
      }
      cache.write(entry, before, item.afterHash); restored.push(item.url); invalidate.add(item.url);
    }
    // Keep generated bytecode as a separate backup; let Chromium regenerate it.
    const restoreJournal = { status: 'restoring-bytecode', bytecode: [] };
    const restoreFile = path.join(directory, 'restore.json');
    moveBytecode(cache.profile, invalidate, path.join(directory, 'restore-bytecode-' + crypto.randomBytes(3).toString('hex')), restoreJournal, restoreFile);
    restoreJournal.status = 'restored'; restoreJournal.restored = restored; restoreJournal.skipped = skipped; save(restoreFile, restoreJournal);
    return { success: true, restored: restored.length, skipped, backup: id };
  });
}
