import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import runtime from '../src/runtime.cjs';
import { buildAsar, readAsar, replaceIntegrity, prepareNative } from '../src/native-package.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { SOURCE } from './fixture.js';

const asset = 'https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/ce044ea01-test.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fake(body = 'original') {
  const debug = new EventEmitter();
  debug.calls = []; debug.isAttached = () => false; debug.attach = () => {};
  debug.sendCommand = async (method, params) => {
    debug.calls.push({ method, params });
    if (method === 'Fetch.getResponseBody') return { body: Buffer.from(body).toString('base64'), base64Encoded: true };
  };
  return debug;
}
const request = (overrides = {}) => ({ requestId: 'test', request: { url: asset, method: 'GET' }, responseStatusCode: 200,
  responseHeaders: [{ name: 'Content-Encoding', value: 'zstd' }, { name: 'Content-Length', value: '10' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'ETag', value: 'old' }], ...overrides });
test('runtime only recognizes exact formula assets', () => {
  assert.equal(runtime.assetKind(asset), 'guard');
  for (const value of [asset+'?x', asset+'#x', asset.replace('https:', 'http:'), asset.replace('assets-proxy.anthropic.com', 'evil.example'), asset.replace('ce044ea01', 'other'), asset.replace('https://', 'https://user@')]) assert.equal(runtime.assetKind(value), null);
});
test('runtime replaces response bytes and removes stale encoding and validators', async () => {
  const debug = fake();
  runtime.attach({ debugger: debug }, { transform: async () => ({ changed: true, source: 'patched' }) });
  debug.emit('message', {}, 'Fetch.requestPaused', request()); await tick();
  const call = debug.calls.find(c => c.method === 'Fetch.fulfillRequest');
  assert.equal(Buffer.from(call.params.body, 'base64').toString(), 'patched');
  assert.deepEqual(call.params.responseHeaders, [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Length', value: '7' }]);
  assert.equal(debug.calls.filter(c => c.method === 'Fetch.continueRequest').length, 0);
});
test('runtime continues unknown responses, failures, redirects and POST without changing them', async () => {
  const debug = fake(); let transforms = 0;
  runtime.attach({ debugger: debug }, { transform: async () => { transforms++; throw new Error('incompatible'); } });
  for (const item of [request(), request({ responseStatusCode: 302 }), request({ request: { method: 'POST', url: asset } }), request({ request: { method: 'GET', url: 'https://claude.ai/api/test' } })]) debug.emit('message', {}, 'Fetch.requestPaused', item);
  await tick();
  assert.equal(transforms, 1);
  assert.equal(debug.calls.filter(c => c.method === 'Fetch.continueRequest').length, 4);
  assert.equal(debug.calls.filter(c => c.method === 'Fetch.fulfillRequest').length, 0);
});
test('runtime does not take over an attached debugger', () => {
  let attached = false;
  runtime.attach({ debugger: { isAttached: () => true, attach: () => { attached = true; } } }, {});
  assert.equal(attached, false);
});
test('runtime reuses a successful transformation for identical code', async () => {
  const debug = fake(); let transforms = 0;
  runtime.attach({ debugger: debug }, { transform: async () => { transforms++; return { changed: true, source: 'patched' }; } });
  debug.emit('message', {}, 'Fetch.requestPaused', request()); await tick();
  debug.emit('message', {}, 'Fetch.requestPaused', request()); await tick();
  assert.equal(transforms, 1);
});
test('runtime omits the empty CDP session argument so requests cannot get stuck', async () => {
  const debug = fake();
  const original = debug.sendCommand;
  debug.sendCommand = function (...args) {
    assert.notEqual(args[2], '');
    return original.apply(this, args);
  };
  runtime.attach({ debugger: debug }, { transform: async () => ({ changed: true, source: 'patched' }) });
  debug.emit('message', {}, 'Fetch.requestPaused', request(), '');
  await tick();
  assert.equal(debug.calls.filter(c => c.method === 'Fetch.fulfillRequest').length, 1);
});
test('startup attaches only when a Claude document navigates, once per contents', async () => {
  const app = new EventEmitter(), contents = new EventEmitter(), debug = fake();
  contents.debugger = debug;
  contents.getURL = () => 'about:blank';
  runtime.start({ app }, { nodePath: process.execPath, worker: '' });
  app.emit('web-contents-created', {}, contents);
  contents.emit('did-start-navigation', { url: 'https://example.com/' });
  assert.equal(debug.calls.length, 0);
  contents.emit('did-start-navigation', { url: 'https://claude.ai/epitaxy' });
  contents.emit('did-start-navigation', { url: 'https://claude.ai/epitaxy/another' });
  await tick();
  assert.equal(debug.calls.filter(c => c.method === 'Fetch.enable').length, 1);
});
function emptyAsar() {
  const raw = Buffer.from('{"files":{}}'), payload = Math.ceil((4+raw.length)/4)*4, result=Buffer.alloc(12+payload);
  result.writeUInt32LE(4,0);result.writeUInt32LE(payload+4,4);result.writeUInt32LE(payload,8);result.writeUInt32LE(raw.length,12);raw.copy(result,16);return result;
}
test('native ASAR build preserves existing bytes and updates file/header integrity', () => {
  const first = buildAsar(emptyAsar(), { 'package.json': Buffer.from('old') });
  const second = buildAsar(first, { '.ccmr/runtime.cjs': Buffer.from('new') });
  const read = readAsar(second), original = readAsar(first);
  assert.ok(read.data.subarray(0, original.data.length).equals(original.data));
  assert.equal(read.header.files['.ccmr'].files['runtime.cjs'].offset, '3');
  assert.equal(read.header.files['.ccmr'].files['runtime.cjs'].integrity.hash, crypto.createHash('sha256').update('new').digest('hex'));
});
test('native EXE update changes only the unique matching ASAR header hash', () => {
  const before=emptyAsar(), after=buildAsar(before, { 'x': Buffer.from('new') });
  const sha = value => crypto.createHash('sha256').update(readAsar(value).raw).digest('hex');
  const original = Buffer.from('MZ'+JSON.stringify([{file:'resources\\app.asar',alg:'SHA256',value:sha(before)}]));
  const result=replaceIntegrity(original,before,after);
  assert.equal(result.length, original.length);
  assert.ok(result.toString().includes(sha(after)));
  assert.ok(original.toString().includes(sha(before)));
  assert.throws(()=>replaceIntegrity(Buffer.concat([original,original]),before,after));
});
test('native preparation packages syntax-checked code and a functioning worker without changing the app', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmr-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), output = path.join(root, 'native-state');
  fs.mkdirSync(path.join(app, 'resources'), { recursive: true });
  const original = buildAsar(emptyAsar(), {
    'package.json': Buffer.from(JSON.stringify({ name: '@ant/desktop', version: '0.0.0-test', main: '.vite/build/index.pre.js' })),
    '.vite/build/index.pre.js': Buffer.from('const app={requestSingleInstanceLock(){return true}};app.requestSingleInstanceLock();require("./index.js");')
  });
  const hash = crypto.createHash('sha256').update(readAsar(original).raw).digest('hex');
  const exe = Buffer.from('MZ'+JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]));
  fs.writeFileSync(path.join(app, 'resources', 'app.asar'), original);
  fs.writeFileSync(path.join(app, 'claude.exe'), exe);
  const manifest = prepareNative(app, output);
  assert.equal(manifest.mode, 'native-runtime');
  assert.ok(fs.readFileSync(path.join(app, 'resources', 'app.asar')).equals(original));
  assert.ok(fs.readFileSync(path.join(app, 'claude.exe')).equals(exe));
  const archive = readAsar(fs.readFileSync(path.join(output, '0.after')));
  const get = name => {
    let item = archive.header;
    for (const part of name.split('/')) item = item.files[part];
    return archive.data.subarray(Number(item.offset), Number(item.offset) + item.size).toString();
  };
  assert.equal(JSON.parse(get('package.json')).main, '.ccmr/bootstrap.cjs');
  const config = JSON.parse(get('.ccmr/bootstrap.cjs').match(/const options=(.*);\noptions.log=/)[1]);
  const result = await runtime.transformInNode(config.nodePath, config.worker, SOURCE, 'guard');
  assert.equal(result.changed, true);
  assert.ok(result.source.includes('/*ccmr:guard:2*/'));
  await assert.rejects(runtime.transformInNode(config.nodePath, config.worker, 'unsupported', 'guard'));
  assert.throws(() => prepareNative(app, output), /new or empty/);
  assert.throws(() => prepareNative(app, fileURLToPath(new URL('../native-state', import.meta.url))), /outside this checkout/);
});
