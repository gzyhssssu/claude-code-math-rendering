import zlib from 'node:zlib';

export const MAX_SOURCE_BYTES = 64 * 1024;
export function decode(body) {
  const options = { maxOutputLength: MAX_SOURCE_BYTES };
  if (body.length >= 4 && body.readUInt32LE(0) === 0xfd2fb528) return zlib.zstdDecompressSync(body, options);
  if (body[0] === 31 && body[1] === 139) return zlib.gunzipSync(body, options);
  throw new Error('Unsupported script encoding (expected Zstandard or gzip).');
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function transform(source) {
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error('Script is unexpectedly large.');
  const constants = source.match(/\b([A-Za-z_$][\w$]*)=(60|1\/0),([A-Za-z_$][\w$]*)=(1024|1\/0)(?=[,;])/);
  const exported = [...source.matchAll(/([A-Za-z_$][\w$]*) as n\b/g)].at(-1)?.[1];
  if (!constants || !exported) throw new Error('Unsupported guard format. No patch generated.');
  const object = source.match(new RegExp(`\\b${escape(exported)}=\\{inlineGuard:([\\w$]+)\\}`));
  if (!object) throw new Error('Single-dollar inline guard export not recognized.');
  // Validate the particular guard's span check and character-count call. Never
  // evaluate code read from the application's cache; cached input is untrusted.
  const definition = source.match(new RegExp(`function ${escape(object[1])}\\(([\\w$]+),([\\w$]+),([\\w$]+),([\\w$]+)\\)\\{if\\(\\4-\\3>${escape(constants[3])}\\)return!1;`));
  if (!definition) throw new Error('Guard span check not recognized.');
  const [, input, , start, end] = definition;
  const counter = new RegExp(`\\b[\\w$]+\\(${escape(input)},${escape(start)},${escape(end)},${escape(constants[1])}\\)`);
  const region = source.slice(definition.index, definition.index + 1400);
  if (!counter.test(region)) throw new Error('Guard character-count check not recognized.');
  const before = constants[2] === '60' && constants[4] === '1024';
  const after = constants[2] === '1/0' && constants[4] === '1/0';
  if (!before && !after) throw new Error('Partially modified or unexpected limits.');
  if (after) return { changed: false, source };
  const patched = source.slice(0, constants.index) + `${constants[1]}=1/0,${constants[3]}=1/0` + source.slice(constants.index + constants[0].length);
  if (Buffer.byteLength(patched) !== Buffer.byteLength(source)) throw new Error('Source length invariant failed.');
  return { changed: true, source: patched };
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
      // RFC 8878 skippable frame, preserving HTTP Content-Length exactly.
      const padding = Buffer.alloc(gap);
      padding.writeUInt32LE(0x184d2a50, 0);
      padding.writeUInt32LE(gap - 8, 4);
      result = Buffer.concat([compressed, padding]);
    }
    if (result.length !== original.length || !decode(result).equals(plain)) throw new Error('Compressed body round-trip failed.');
    return result;
  }
  throw new Error('Replacement cannot fit the original compressed response length.');
}
