import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const isGuardURL = value => /^https:\/\/assets-proxy\.anthropic\.com\/claude-ai\/v2\/assets\/v1\/ce044ea01-[A-Za-z0-9_-]+\.js$/.test(value);
export function assetKind(value) {
  const match = /^https:\/\/assets-proxy\.anthropic\.com\/claude-ai\/v2\/assets\/v1\/(ce044ea01|cfa45e123|shared-12|c648dc9d7)-[A-Za-z0-9_-]+\.js$/.exec(value);
  return match ? ({ ce044ea01: 'guard', cfa45e123: 'parser', 'shared-12': 'alternate', c648dc9d7: 'alternate' })[match[1]] : null;
}
export const isAssetURL = value => assetKind(value) !== null;
export function within(root, candidate) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export function safeFile(root, name) {
  if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('Invalid cache filename.');
  const file = path.join(root, name);
  if (fs.lstatSync(file).isSymbolicLink() || !within(root, file)) throw new Error('Cache links outside the profile are not supported.');
  if (!fs.statSync(file).isFile()) throw new Error('Expected a cache file.');
  return file;
}
function header(bytes) {
  if (bytes.length < 8192 || bytes.readUInt32LE(0) !== 0xc104cac3 || bytes.readUInt32LE(4) !== 0x20000) throw new Error('Unsupported Chromium blockfile header.');
  return { blockSize: bytes.readInt32LE(12), maxEntries: bytes.readInt32LE(20) };
}
function allocated(bytes, index) {
  return index >= 0 && index < (8192 - 80) * 8 && (bytes[80 + (index >>> 3)] & (1 << (index & 7))) !== 0;
}

export class Cache {
  constructor(profile) {
    this.profile = fs.realpathSync(profile);
    this.directory = fs.realpathSync(path.join(this.profile, 'Cache', 'Cache_Data'));
    if (!within(this.profile, this.directory)) throw new Error('Cache directory escapes profile.');
  }
  read(location) {
    const file = safeFile(this.directory, location.file);
    if (!Number.isSafeInteger(location.offset) || location.offset < 0 || !Number.isSafeInteger(location.size) || location.size < 1 || location.size > 1024 * 1024) throw new Error('Invalid cache range.');
    if (location.offset + location.size > fs.statSync(file).size) throw new Error('Cache range is outside file.');
    const fd = fs.openSync(file, 'r');
    try {
      const result = Buffer.alloc(location.size);
      if (fs.readSync(fd, result, 0, result.length, location.offset) !== result.length) throw new Error('Short cache read.');
      return result;
    } finally { fs.closeSync(fd); }
  }
  locate(address, size) {
    if (!(address >>> 31) || !Number.isInteger(size) || size < 1 || size > 1024 * 1024) throw new Error('Invalid cache address.');
    const type = (address >>> 28) & 7;
    if (type === 0) return { file: `f_${(address & 0x0fffffff).toString(16).padStart(6, '0')}`, offset: 0, size };
    if (address & 0x0c000000) throw new Error('Invalid reserved cache address bits.');
    const blockSize = { 2: 256, 3: 1024, 4: 4096 }[type];
    if (!blockSize) throw new Error('Unsupported body block type.');
    const file = `data_${(address >>> 16) & 255}`;
    const bytes = fs.readFileSync(safeFile(this.directory, file));
    const meta = header(bytes);
    const index = address & 65535;
    const blocks = ((address >>> 24) & 3) + 1;
    if (meta.blockSize !== blockSize || size > blocks * blockSize || index + blocks > meta.maxEntries) throw new Error('Cache address does not match its block file.');
    for (let i = index; i < index + blocks; i++) if (!allocated(bytes, i)) throw new Error('Body refers to a free cache block.');
    const location = { file, offset: 8192 + index * blockSize, size };
    if (location.offset + size > bytes.length) throw new Error('Body is outside cache file.');
    return location;
  }
  entries() {
    const results = [];
    // Additional 256-byte block files can exist after data_1 fills up.
    for (const file of fs.readdirSync(this.directory).filter(name => /^data_\d+$/.test(name))) {
      const bytes = fs.readFileSync(safeFile(this.directory, file));
      const meta = header(bytes);
      if (meta.blockSize !== 256) continue;
      const count = Math.min(meta.maxEntries, Math.floor((bytes.length - 8192) / 256));
      for (let index = 0; index < count; index++) {
        if (!allocated(bytes, index)) continue;
        const offset = 8192 + index * 256;
        const record = bytes.subarray(offset, offset + 256);
        if (record.readInt32LE(20) !== 0 || record.readUInt32LE(36) !== 0) continue;
        const length = record.readInt32LE(32);
        if (length < 30 || length > 927 || offset + 96 + length > bytes.length) continue;
        const key = bytes.subarray(offset + 96, offset + 96 + length).toString('utf8');
        const url = key.match(/https:\/\/assets-proxy\.anthropic\.com\/claude-ai\/v2\/assets\/v1\/(?:ce044ea01|cfa45e123|shared-12|c648dc9d7)-[A-Za-z0-9_-]+\.js$/)?.[0];
        if (!url || !isAssetURL(url)) continue;
        const entry = { url, kind: assetKind(url), entryFile: file, entryOffset: offset, entryHash: sha(record), keyHash: sha(Buffer.from(key)) };
        try { entry.location = this.locate(record.readUInt32LE(60), record.readInt32LE(44)); }
        catch (error) { entry.error = error.message; }
        results.push(entry);
      }
    }
    return results;
  }
  verify(entry, expectedBodyHash) {
    if (!isAssetURL(entry.url) || !/^data_\d+$/.test(entry.entryFile) || entry.entryOffset < 8192 || entry.entryOffset % 256 !== 0) throw new Error('Invalid entry identity.');
    const record = this.read({ file: entry.entryFile, offset: entry.entryOffset, size: 256 });
    const actual = this.locate(record.readUInt32LE(60), record.readInt32LE(44));
    if (actual.file !== entry.location.file || actual.offset !== entry.location.offset || actual.size !== entry.location.size) throw new Error('Entry body location changed.');
    if (sha(record) !== entry.entryHash || sha(this.read(entry.location)) !== expectedBodyHash) throw new Error('Cache entry changed; refusing to overwrite it.');
  }
  write(entry, bytes, expectedBodyHash) {
    this.verify(entry, expectedBodyHash);
    if (bytes.length !== entry.location.size) throw new Error('Body length changed.');
    const file = safeFile(this.directory, entry.location.file);
    const fd = fs.openSync(file, 'r+');
    try {
      if (fs.writeSync(fd, bytes, 0, bytes.length, entry.location.offset) !== bytes.length) throw new Error('Incomplete cache write.');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (sha(this.read(entry.location)) !== sha(bytes)) throw new Error('Post-write verification failed.');
  }
}

export function bytecodeFiles(profile, urls) {
  const directory = path.join(profile, 'Code Cache', 'js');
  if (!fs.existsSync(directory)) return [];
  if (!within(profile, directory)) throw new Error('Code cache directory escapes profile.');
  const result = [];
  const candidates = new Map();
  // Chromium names entries with the first 64 little-endian bits of SHA-1(key).
  // Probe recognized Claude origin locks instead of scanning every cached app
  // script on each patch. Each candidate is still checked against its key.
  for (const url of urls) for (const origin of ['https://claude.ai/', 'https://claude.ai', 'app://localhost/', 'app://localhost', '']) {
    const key = '_key' + url + ' \n' + origin;
    const hash = crypto.createHash('sha1').update(key).digest().readBigUInt64LE(0).toString(16).padStart(16, '0');
    candidates.set(hash + '_0', key);
  }
  for (const [name, expectedKey] of candidates) {
    if (!fs.existsSync(path.join(directory, name))) continue;
    const file = safeFile(directory, name);
    const fd = fs.openSync(file, 'r');
    let bytes;
    try { const buffer = Buffer.alloc(2048); bytes = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)); }
    finally { fs.closeSync(fd); }
    // SimpleFileHeader: uint64 magic, uint32 version, uint32 key_length.
    // Match the key itself, rather than an import reference in compiled code.
    if (bytes.length < 24 || bytes.readBigUInt64LE(0) !== 0xfcfb6d1ba7725c30n) continue;
    const length = bytes.readUInt32LE(12);
    if (length > bytes.length - 24) continue;
    const key = bytes.subarray(24, 24 + length).toString('utf8');
    if (key !== expectedKey) continue;
    for (const suffix of ['0', '1', '2']) {
      const sibling = name.slice(0, -1) + suffix;
      if (!fs.existsSync(path.join(directory, sibling))) continue;
      safeFile(directory, sibling); result.push({ directory, name: sibling });
    }
  }
  return result;
}
