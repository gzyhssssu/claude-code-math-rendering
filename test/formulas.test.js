import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inlinePolicy, displayPolicy } from '../src/math-policy.js';
import { transform } from '../src/patcher.js';
import { SOURCE } from './fixture.js';

const bodies = ['x', '1', 'α', '2x', '10', 'xy', 'x_ij', 'Q1(a)', '\\hat\\phi', '\\frac12', 'x_{12}', 'x_{ij}', 'x_{i,j}', 'e^{ikx}', '\\ket{01}', 'E_{\\text{kin}}', '\\sin x', '2\\pi'];
const wrappers = [[' ', ' '], ['"', '"'], ["'", "'"], ['中文', '文字'], ['', 'A'], ['', '2']];
const pure = source => source.replace(/export\{[^}]*\};/g, '');

test('quoted accents, Greek, numeric and adjacent-letter formulas pass the installed guard', () => {
  const guard = vm.runInNewContext(pure(transform(SOURCE).source) + ';Q.inlineGuard');
  for (const body of bodies) for (const [left, right] of wrappers) {
    const text = left + '$' + body + '$' + right, start = left.length + 1;
    assert.equal(guard(text, left.length, start, start + body.length), true, text);
  }
});
test('rejects empty, whitespace-only, multiline and common monetary ranges', () => {
  for (const body of ['', ' ', ' x', 'x ', 'x\ny', 'x\ry']) assert.equal(inlinePolicy(body, 0, 0, body.length), false);
  assert.equal(inlinePolicy('$5-$10', 0, 1, 3), false);
  assert.equal(inlinePolicy('$10$', 0, 1, 3), true);
  assert.equal(displayPolicy('   \n '), false);
  assert.equal(displayPolicy('\\begin{aligned}\nx&=1\n\\end{aligned}'), true);
});
test('backslash guard policy has no 200-character or math-signal requirement', () => {
  for (const body of ['1', 'α', 'xy', 'a'.repeat(10000)]) {
    const text = '\\(' + body + '\\)';
    assert.equal(inlinePolicy(text, 0, 2, 2 + body.length), true);
  }
});

// These small, authored scanners simulate the recognizable vendor structures;
// they are not extracted application code. Only the compatibility surfaces
// needed to exercise the static transforms are represented.
const PARSER = String.raw`var absent=-2,incomplete=-1;function digit(e){return /^\d/.test(e||"")}function letter(e){return /^[A-Za-z]$/.test(e||"")}function numeric(e){return /^\d/.test(e)}function lexical(e){return!0}function tail(){return /[A-Z]/}var suffix=/^[A-Z]{0,3}$/;function scanner(e,t,n,r,i,a={before:1/0}){let o=e[t+1];if(!o||o==="$")return t;let s=digit(o);if(s&&t>0&&letter(e[t-1]))return t;if(!s){i.sheetLen??=0;if(i.sheetLen>0)return t}let c=!n&&e.length>r;for(let n=t+1;n<e.length;n++){if(e[n]==="\n"||n>=a.before)return absent;if(e[n]!=="$")continue;let r=0;for(let i=n-1;i>t&&e[i]==="\\";i--)r++;if(r%2!=1)return e[n-1]===" "||s&&!numeric(e.slice(t+1,n))||digit(e[n+1])||s&&n+1<e.length&&tail().test(e[n+1])?t:c&&suffix.test(e.slice(n+1))?incomplete:n}return c?s&&!lexical(e.slice(t+1))?t:incomplete:absent}var options={singleDollarTextMath:!0};export{scanner as test};`;
const ALTERNATE = String.raw`function digitAt(e,t){return /^\d/.test(e[t+1]||"")}function context(){return!1}function sheet(){return-1}function valid(e,t){let n=0;for(let i=t-1;i>=0&&e[i]==="\\";i--)n++;return n%2===0&&e[t-1]!=="$"&&e[t+1]!=="$"&&!/\s/.test(e[t+1]||" ")}function close(e,t){return e.indexOf("$",t)}function good(e,t){return !digitAt(e,t)}function finder(e,t){let n=!1;do{t=e.indexOf("$",t),n=t>-1&&valid(e,t);let r=n&&!digitAt(e,t)?sheet(e,t):-1;r>-1&&r>t?(n=!1,t=r+1):!n&&t>-1&&(t+=1)}while(t>-1&&!n);return t}function scan(e,t=!0,n=!0,r=""){let i=typeof n==="object"?n:null,a=typeof t==="object"?t:null,d=(t,n,i,r)=>t.inlineGuard(e,n,i,r),p=t=>{for(let n=finder(e,t);n!==-1;n=finder(e,n+1)){let t=close(e,n+1);if(t===-1)return null;if(good(e,t)&&(!digitAt(e,n)||context(e,n,t))&&(!a||d(a,n,n+1,t))){return{start:n,end:t+1,bodyStart:n+1,bodyEnd:t,body:e.slice(n+1,t)}}}return null};return p}var end=1;export{scan as test};`;

test('primary scanner no longer rejects numeric content or spreadsheet-looking tails', () => {
  const patch = transform(PARSER, 'parser');
  const scanner = vm.runInNewContext(pure(patch.source) + ';scanner');
  for (const body of bodies) for (const suffix of ['', 'A', '2', '"']) {
    const text = '$' + body + '$' + suffix;
    assert.equal(scanner(text, 0, false, 0, { sheetLen: 12 }), body.length + 1, text);
  }
  assert.equal(transform(patch.source, 'parser').changed, false);
});
test('primary scanner preserves escaped closers, newlines, boundaries, and pending sentinels', () => {
  const scanner = vm.runInNewContext(pure(transform(PARSER, 'parser').source) + ';scanner');
  assert.equal(scanner('$x\\$y$', 0, false, 0, {}), 5);
  assert.equal(scanner('$x\ny$', 0, false, 0, {}), -2);
  assert.equal(scanner('$x$', 0, false, 0, {}, { before: 2 }), -2);
  assert.equal(scanner('$x', 0, false, 0, {}), -1);
  assert.equal(scanner('$x', 0, true, 2, {}), -2);
  assert.equal(scanner('$x $', 0, false, 0, {}), 0);
});
test('alternate renderer no longer applies a second numeric currency filter', () => {
  const patch = transform(ALTERNATE, 'alternate');
  const factory = vm.runInNewContext(pure(patch.source) + ';scan');
  const guard = { inlineGuard: inlinePolicy };
  for (const body of bodies) {
    const text = '"$' + body + '$"';
    const result = factory(text, guard, false)(0);
    assert.equal(result?.body, body, text);
  }
  assert.equal(factory('cost $20 and $30', guard, false)(0), null);
  assert.equal(transform(patch.source, 'alternate').changed, false);
});
test('parser and alternate transforms refuse unfamiliar code instead of guessing', () => {
  assert.throws(() => transform(PARSER.replaceAll('.sheetLen', '.changedField'), 'parser'));
  assert.throws(() => transform(ALTERNATE.replace('bodyEnd:', 'changedEnd:'), 'alternate'));
});
