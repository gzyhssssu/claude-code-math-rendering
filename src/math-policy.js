// Explicit delimiters express math intent. Markdown still owns code, links,
// escaped opening markers, block fences, and streaming token boundaries.
export function inlinePolicy(input, opener, start, end) {
  const body = input.slice(start, end).replace(/[\uE000\uFDEE]/g, '');
  return body.length > 0 && !/^\s|\s$|[\r\n]/.test(body)
    && !(/^\d[\d.,]*[-\u2013\u2014]$/.test(body) && /\d/.test(input[end + 1] || ''));
}
export function displayPolicy(body) {
  return body.replace(/[\uE000\uFDEE]/g, '').trim().length > 0;
}
