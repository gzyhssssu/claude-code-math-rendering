import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function readAsar(buffer) {
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR header.');
  const headerSize = buffer.readUInt32LE(4), jsonSize = buffer.readUInt32LE(12);
  if (headerSize < jsonSize + 8 || headerSize > 8 * 1024 * 1024 || 8 + headerSize > buffer.length) throw new Error('Invalid ASAR sizes.');
  const raw = buffer.subarray(16, 16 + jsonSize);
  const header = JSON.parse(raw);
  return { header, raw, data: buffer.subarray(8 + headerSize) };
}
function entry(header, name, create = false) {
  let current = header;
  const parts = name.split('/');
  for (const part of parts) {
    if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('Invalid ASAR entry name.');
    if (!current.files && create) current.files = {};
    if (!current.files?.[part] && create) current.files[part] = {};
    current = current.files?.[part];
    if (!current) throw new Error('ASAR entry missing: ' + name);
  }
  return current;
}
function packed(archive, name) {
  const item = entry(archive.header, name);
  if (item.unpacked || item.link || !Number.isSafeInteger(item.size) || !/^\d+$/.test(item.offset)) throw new Error('Unexpected ASAR entry.');
  const offset = Number(item.offset), bytes = archive.data.subarray(offset, offset + item.size);
  if (bytes.length !== item.size || item.integrity?.hash !== hash(bytes)) throw new Error('ASAR entry integrity mismatch.');
  return bytes;
}
export function buildAsar(original, additions) {
  const archive = readAsar(original);
  let offset = archive.data.length;
  const buffers = [archive.data];
  for (const [name, bytes] of Object.entries(additions)) {
    if (!/^[\w./-]+$/.test(name) || name.includes('..')) throw new Error('Invalid ASAR path.');
    const item = entry(archive.header, name, true);
    const blockSize = 4194304, blocks = [];
    for (let at = 0; at < bytes.length; at += blockSize) blocks.push(hash(bytes.subarray(at, at + blockSize)));
    Object.assign(item, { size: bytes.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: hash(bytes), blockSize, blocks } });
    delete item.unpacked; delete item.link;
    offset += bytes.length; buffers.push(bytes);
  }
  const raw = Buffer.from(JSON.stringify(archive.header));
  const payloadSize = Math.ceil((4 + raw.length) / 4) * 4;
  const prefix = Buffer.alloc(16 + payloadSize - 4);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(payloadSize + 4, 4);
  prefix.writeUInt32LE(payloadSize, 8); prefix.writeUInt32LE(raw.length, 12); raw.copy(prefix, 16);
  return Buffer.concat([prefix, ...buffers]);
}
export function replaceIntegrity(executable, before, after) {
  if (executable.readUInt16LE(0) !== 0x5a4d) throw new Error('Expected Windows executable.');
  const oldHash = hash(readAsar(before).raw), newHash = hash(readAsar(after).raw);
  const needle = Buffer.from(`"file":"resources\\\\app.asar","alg":"SHA256","value":"${oldHash}"`);
  const at = executable.indexOf(needle);
  if (at < 0 || executable.indexOf(needle, at + 1) >= 0) throw new Error('Unique embedded ASAR integrity record not found.');
  const result = Buffer.from(executable);
  result.write(newHash, at + needle.length - 65, 64, 'ascii');
  return result;
}
export function prepareNative(appDir, outputDir, nodePath = process.execPath) {
  appDir = fs.realpathSync(appDir);
  outputDir = path.resolve(outputDir);
  const relative = path.relative(ROOT, outputDir);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Native backups must be outside this checkout.');
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw new Error('Output directory must be new or empty; keep previous backups.');
  const original = fs.readFileSync(path.join(appDir, 'resources', 'app.asar'));
  const archive = readAsar(original);
  const pkg = JSON.parse(packed(archive, 'package.json'));
  if (pkg.name !== '@ant/desktop' || pkg.main !== '.vite/build/index.pre.js') throw new Error('Unsupported Claude entry point.');
  const entrySource = packed(archive, pkg.main).toString('utf8');
  if (!entrySource.includes('requestSingleInstanceLock') || !entrySource.includes('require("./index.js")')) throw new Error('Unsupported Claude bootstrap.');
  const policy = fs.readFileSync(path.join(ROOT, 'src', 'math-policy.js'), 'utf8').replaceAll('export function ', 'function ');
  const patcher = fs.readFileSync(path.join(ROOT, 'src', 'patcher.js'), 'utf8')
    .replace("import { inlinePolicy, displayPolicy } from './math-policy.js';", policy).replaceAll('export ', '');
  const worker = patcher + `\nimport fs from 'node:fs';\ntry { const r=transform(fs.readFileSync(0,'utf8'),process.argv[1]);process.stdout.write(JSON.stringify(r)); } catch {process.exitCode=1;}\n`;
  const runtime = fs.readFileSync(path.join(ROOT, 'src', 'runtime.cjs'), 'utf8');
  const config = JSON.stringify({ nodePath, worker });
  const boot = [
    '"use strict";',
    "const fs=require('node:fs'),path=require('node:path'),electron=require('electron');",
    `const options=${config};`,
    "options.log=(event,data)=>{try{const file=path.join(electron.app.getPath('userData'),'ccmr-runtime.jsonl');let size=0;try{size=fs.statSync(file).size}catch{};if(size>1048576)fs.renameSync(file,file+'.old');fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),event,...data})+String.fromCharCode(10))}catch{}};",
    "try{require('./runtime.cjs').start(electron,options)}catch{}",
    "require('../.vite/build/index.pre.js');"
  ].join(String.fromCharCode(10));
  for (const [code, type] of [[boot, 'commonjs'], [runtime, 'commonjs'], [worker, 'module']]) {
    execFileSync(nodePath, ['--check', '--input-type=' + type], { input: code, timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  pkg.main = '.ccmr/bootstrap.cjs';
  const patched = buildAsar(original, { 'package.json': Buffer.from(JSON.stringify(pkg, null, 2)), '.ccmr/bootstrap.cjs': Buffer.from(boot), '.ccmr/runtime.cjs': Buffer.from(runtime) });
  const exe = fs.readFileSync(path.join(appDir, 'claude.exe'));
  const patchedExe = replaceIntegrity(exe, original, patched);
  fs.mkdirSync(outputDir, { recursive: true });
  const targets = [
    { relative: 'resources/app.asar', before: original, after: patched },
    { relative: 'claude.exe', before: exe, after: patchedExe }
  ];
  const files = targets.map((item, index) => {
    const before = `${index}.before`, after = `${index}.after`;
    fs.writeFileSync(path.join(outputDir, before), item.before, { flag: 'wx' });
    fs.writeFileSync(path.join(outputDir, after), item.after, { flag: 'wx' });
    return { relative: item.relative, before, after, beforeHash: hash(item.before), afterHash: hash(item.after) };
  });
  const manifest = { format: 1, mode: 'native-runtime', version: pkg.version, appDir: path.resolve(appDir), nodePath, files, signatureImpact: 'Claude.exe Authenticode signature becomes invalid; Electron ASAR integrity stays enabled.' };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
