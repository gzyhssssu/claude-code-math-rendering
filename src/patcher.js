import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { inlinePolicy, displayPolicy } from './math-policy.js';

export const MAX_SOURCE_BYTES = 1024 * 1024;
export function decode(body) {
  const options = { maxOutputLength: MAX_SOURCE_BYTES };
  if (body.length >= 4 && body.readUInt32LE(0) === 0xfd2fb528) return zlib.zstdDecompressSync(body, options);
  if (body[0] === 31 && body[1] === 139) return zlib.gunzipSync(body, options);
  throw new Error('Unsupported script encoding (expected Zstandard or gzip).');
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Only our own functions are compacted. Vendor JavaScript is never evaluated.
const compact = fn => fn.toString().replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\s+/g, ' ').trim();
function named(fn, name) { return compact(fn).replace(/^function \w+/, 'function ' + name); }
function functionRange(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Expected function missing: ' + name);
  const following = /\}(?=(?:var [\w$]+=|function [\w$]+\())/g;
  following.lastIndex = start;
  const end = following.exec(source);
  if (!end || end.index - start > 6000) throw new Error('Unrecognized module function boundary.');
  return { start, end: end.index + 1, text: source.slice(start, end.index + 1) };
}
function replaceFunction(source, name, replacement) {
  const range = functionRange(source, name);
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}
function finish(original, source, marker) {
  const gap = Buffer.byteLength(original) - Buffer.byteLength(source) - marker.length;
  const output = source + marker + ' '.repeat(Math.max(0, gap));
  // Parse as an ES module without executing it or resolving its imports.
  try { execFileSync(process.execPath, ['--check', '--input-type=module'], { input: output, timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('Patched module failed syntax validation. No patch generated.'); }
  return { changed: true, source: output };
}
function guardTransform(source) {
  const marker = '/*ccmr:guard:2*/';
  if (source.includes(marker)) return { changed: false, source };
  const constants = source.match(/\b([\w$]+)=(60|1\/0),([\w$]+)=(1024|1\/0)(?=[,;])/);
  const exported = [...source.matchAll(/([\w$]+) as n\b/g)].at(-1)?.[1];
  if (!constants || !exported) throw new Error('Unsupported guard format. No patch generated.');
  const object = source.match(new RegExp(`\\b${escape(exported)}=\\{inlineGuard:([\\w$]+)\\}`));
  if (!object) throw new Error('Single-dollar inline guard export not recognized.');
  const range = functionRange(source, object[1]);
  const args = range.text.match(/^function [\w$]+\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)\{if\(\4-\3>([\w$]+)\)return!1;/);
  if (!args || args[5] !== constants[3] || !new RegExp(`\\b[\\w$]+\\(${escape(args[1])},${escape(args[3])},${escape(args[4])},${escape(constants[1])}\\)`).test(range.text)) throw new Error('Guard length/count structure not recognized.');
  if ((constants[2] === '60') !== (constants[4] === '1024')) throw new Error('Partially modified limits.');
  let patched = replaceFunction(source, object[1], named(inlinePolicy, object[1]));
  const alternate = source.match(/\b[\w$]+=\{inlineGuard:([\w$]+),displayOneLineGate:([\w$]+)\}/);
  if (alternate) {
    const inline = functionRange(source, alternate[1]), display = functionRange(source, alternate[2]);
    if (!inline.text.includes(',200)') || !display.text.includes('.length>')) throw new Error('Backslash guard structure not recognized.');
    patched = replaceFunction(patched, alternate[1], named(inlinePolicy, alternate[1]));
    patched = replaceFunction(patched, alternate[2], named(displayPolicy, alternate[2]));
  }
  const proseExport = [...source.matchAll(/([\w$]+) as i\b/g)].at(-1)?.[1];
  if (proseExport) {
    const prose = functionRange(source, proseExport);
    if (!prose.text.includes('fenced:') || !prose.text.includes('.some(')) throw new Error('Explicit math-fence filter not recognized.');
    patched = replaceFunction(patched, proseExport, `function ${proseExport}(){return!1}`);
  }
  return finish(source, patched, marker);
}
function parserTransform(source) {
  const marker = '/*ccmr:parser:2*/';
  if (source.includes(marker)) return { changed: false, source };
  const scanner = source.match(/function ([\w$]+)\(e,t,n,r,i,a=\{before:1\/0\}\)\{/);
  if (!scanner || !source.includes('singleDollarTextMath:')) throw new Error('Inline parser scanner not recognized.');
  const range = functionRange(source, scanner[1]);
  const missing = range.text.match(/\|\|n>=a\.before\)return ([\w$]+);/);
  const pending = range.text.match(/\?([\w$]+):n\}/);
  if (!missing || !pending || !range.text.includes('.sheetLen') || !range.text.includes('s&&!')) throw new Error('Currency/spreadsheet scanner structure not recognized.');
  let replacement = range.text;
  const prelude = /let s=[\w$]+\(o\);[\s\S]+?(?=let c=!n&&e\.length>r;)/;
  const numericContent = /\|\|s&&![\w$]+\(e\.slice\(t\+1,n\)\)/;
  const nextDigit = /\|\|[\w$]+\(e\[n\+1\]\)/;
  const numericTail = /\|\|s&&n\+1<e\.length&&[\w$]+\(\)\.test\(e\[n\+1\]\)/;
  const sheetTail = /c&&[\w$]+\.test\(e\.slice\(n\+1\)\)\?[\w$]+:n/;
  const openTail = /return c\?s&&![\w$]+\(e\.slice\(t\+1\)\)\?t:([\w$]+):([\w$]+)\}/;
  if (![prelude, numericContent, nextDigit, numericTail, sheetTail, openTail].every(pattern => pattern.test(replacement))) throw new Error('Dollar scanner heuristics changed.');
  replacement = replacement.replace(prelude, '').replace(numericContent, '').replace(nextDigit, '').replace(numericTail, '').replace(sheetTail, 'n').replace(openTail, 'return c?$1:$2}');
  return finish(source, replaceFunction(source, scanner[1], replacement), marker);
}
function alternateTransform(source) {
  const marker = '/*ccmr:alternate:2*/';
  if (source.includes(marker)) return { changed: false, source };
  const scanner = source.match(/function ([\w$]+)\(e,t=!0,n=!0,r=""\)\{/);
  if (!scanner) throw new Error('Alternate renderer scanner not recognized.');
  const range = functionRange(source, scanner[1]);
  if (!range.text.includes('.inlineGuard(') || !range.text.includes('bodyStart:') || !range.text.includes('bodyEnd:')) throw new Error('Alternate renderer scanner structure not recognized.');
  const opener = range.text.match(/for\(let n=([\w$]+)\(e,t\);n!==-1;n=\1\(e,n\+1\)\)/);
  const condition = /if\([\w$]+\(e,t\)&&\(![\w$]+\(e,n\)\|\|[\w$]+\(e,n,t\)\)&&/;
  if (!opener || !condition.test(range.text)) throw new Error('Alternate currency check changed.');
  const openRange = functionRange(source, opener[1]);
  const sheetCheck = /let r=n&&![\w$]+\(e,t\)\?[\w$]+\(e,t\):-1/;
  const validOpener = openRange.text.match(/n=t>-1&&([\w$]+)\(e,t\)/);
  if (!sheetCheck.test(openRange.text) || !validOpener) throw new Error('Alternate spreadsheet check changed.');
  let patched = replaceFunction(source, scanner[1], range.text.replace(condition, 'if(!/\\s/.test(e[t-1])&&'));
  const openReplacement = `function ${opener[1]}(e,t){for(;t>-1;){t=e.indexOf("$",t);if(t<0||${validOpener[1]}(e,t))return t;t++}return-1}`;
  patched = replaceFunction(patched, opener[1], openReplacement);
  return finish(source, patched, marker);
}
export function transform(source, kind = 'guard') {
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error('Script is unexpectedly large.');
  if (kind === 'guard') return guardTransform(source);
  if (kind === 'parser') return parserTransform(source);
  if (kind === 'alternate') return alternateTransform(source);
  throw new Error('Unsupported asset kind.');
}
export function encodeSameSize(source, original) {
  if (original.length < 4 || original.readUInt32LE(0) !== 0xfd2fb528) throw new Error('Writing is supported only for Zstandard responses.');
  const plain = Buffer.from(source);
  for (const level of [15, 19, 22, 9, 3]) {
    const compressed = zlib.zstdCompressSync(plain, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });
    const gap = original.length - compressed.length;
    if (gap < 0 || (gap > 0 && gap < 8)) continue;
    let result = compressed;
    if (gap >= 8) {
      const padding = Buffer.alloc(gap);
      padding.writeUInt32LE(0x184d2a50, 0); padding.writeUInt32LE(gap - 8, 4);
      result = Buffer.concat([compressed, padding]);
    }
    if (result.length !== original.length || !decode(result).equals(plain)) throw new Error('Compressed body round-trip failed.');
    return result;
  }
  throw new Error('Replacement cannot fit the original compressed response length.');
}
