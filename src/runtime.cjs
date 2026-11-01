'use strict';
// In-process response hook. No listening socket, proxy, certificate or chat access.
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const PREFIX = 'https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/';
const ASSETS = { ce044ea01: 'guard', cfa45e123: 'parser', 'shared-12': 'alternate', c648dc9d7: 'alternate' };
function assetKind(value) {
  try {
    const u = new URL(value);
    if (u.origin !== 'https://assets-proxy.anthropic.com' || u.search || u.hash || u.username || u.password) return null;
    const match = value.slice(PREFIX.length).match(/^(ce044ea01|cfa45e123|shared-12|c648dc9d7)-[A-Za-z0-9_-]+\.js$/);
    return value.startsWith(PREFIX) && match ? ASSETS[match[1]] : null;
  } catch { return null; }
}
function transformInNode(nodePath, worker, source, kind) {
  return new Promise((resolve, reject) => {
    const child = execFile(nodePath, ['--input-type=module', '-e', worker, kind], {
      windowsHide: true, timeout: 12000, maxBuffer: 3 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '' }
    }, (error, stdout) => {
      if (error) { reject(new Error('Formula worker failed.')); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid formula worker response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(source);
  });
}
function attach(contents, { transform, log = () => {} }) {
  const debug = contents.debugger;
  if (debug.isAttached()) { log('unavailable', { reason: 'debugger-already-attached' }); return; }
  const memo = new Map();
  const report = (event, data) => { try { log(event, data); } catch {} };
  try { debug.attach('1.3'); }
  catch { report('unavailable', { reason: 'attach-failed' }); return; }
  debug.on('detach', () => report('detached', {}));
  debug.on('message', async (_event, method, params, sessionId) => {
    if (method !== 'Fetch.requestPaused') return;
    const requestId = params.requestId;
    const send = (name, value) => sessionId ? debug.sendCommand(name, value, sessionId) : debug.sendCommand(name, value);
    let fulfilled = false;
    const kind = assetKind(params.request?.url);
    try {
      if (!kind || params.request.method !== 'GET' || params.responseStatusCode !== 200 || params.responseErrorReason) return;
      const length = params.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value;
      if (length && Number(length) > 1024 * 1024) throw new Error('oversized-response');
      const result = await send('Fetch.getResponseBody', { requestId });
      const body = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
      if (body.length > 1024 * 1024) throw new Error('oversized-source');
      const key = kind + ':' + crypto.createHash('sha256').update(body).digest('hex');
      let pending = memo.get(key);
      if (!pending) {
        pending = transform(body.toString('utf8'), kind);
        memo.set(key, pending);
        if (memo.size > 16) memo.delete(memo.keys().next().value);
      }
      const replacement = await pending;
      if (!replacement.changed) { report('already-patched', { kind }); return; }
      const bytes = Buffer.from(replacement.source);
      // CDP returns decompressed source. Never retain the original wire encoding/size.
      const removed = new Set(['content-length', 'content-encoding', 'etag', 'content-md5', 'digest', 'content-digest', 'repr-digest']);
      const responseHeaders = (params.responseHeaders || []).filter(h => !removed.has(h.name.toLowerCase()));
      responseHeaders.push({ name: 'Content-Length', value: String(bytes.length) });
      await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders, body: bytes.toString('base64') });
      fulfilled = true;
      report('patched', { kind, asset: params.request.url.slice(PREFIX.length) });
    } catch (error) {
      report('skipped', { kind, reason: String(error.message || error).slice(0, 200) });
    } finally {
      if (!fulfilled) try { await send('Fetch.continueRequest', { requestId }); } catch {}
    }
  });
  debug.sendCommand('Fetch.enable', {
    patterns: Object.keys(ASSETS).map(stem => ({ urlPattern: PREFIX + stem + '-*.js', requestStage: 'Response', resourceType: 'Script' }))
  }).then(() => report('attached', {}), () => {
    report('unavailable', { reason: 'fetch-enable-failed' });
    try { debug.detach(); } catch {}
  });
}
function start(electron, options) {
  const transform = (source, kind) => transformInNode(options.nodePath, options.worker, source, kind);
  const shouldAttach = options.shouldAttach || (value => {
    try { return new URL(value).origin === 'https://claude.ai'; } catch { return false; }
  });
  electron.app.on('web-contents-created', (_event, contents) => {
    let attempted = false;
    const consider = (details, legacyURL) => {
      if (attempted || !shouldAttach(details?.url || legacyURL || '')) return;
      attempted = true;
      attach(contents, { transform, log: options.log });
    };
    contents.on('did-start-navigation', consider);
    consider({ url: contents.getURL() });
  });
}
module.exports = { assetKind, attach, start, transformInNode };
