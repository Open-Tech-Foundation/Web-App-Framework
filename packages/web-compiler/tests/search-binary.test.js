import { expect, test } from 'runtime:test';
import { file, makeTempDir, remove, write } from 'runtime:fs';
import { dirname, fromFileURL, join } from 'runtime:path';
import { otfSearchPath } from '../extract.js';
const here = dirname(fromFileURL(import.meta.url));

test('search resolves explicit overrides and platform-specific sibling executables', async () => {
  const dir = await makeTempDir({ dir: here, prefix: 'search-bin-' });
  try {
    const override = join(dir, 'custom-search');
    await write(override, 'override');
    expect(await otfSearchPath({ environment: { OTF_SEARCH_BIN: override } })).toBe(override);
    await write(join(dir, 'otf-search.exe'), 'windows');
    expect(await otfSearchPath({ otfwc: join(dir, 'otfwc.exe'), os: 'windows', environment: {} })).toBe(join(dir, 'otf-search.exe'));
    let error;
    try { await otfSearchPath({ environment: { OTF_SEARCH_BIN: join(dir, 'missing') } }); } catch (e) { error = e; }
    expect(error.message).toContain('OTF_SEARCH_BIN');
  } finally { await remove(dir, { recursive: true }); }
});

test('search lazily decompresses the packaged sibling archive', async () => {
  const dir = await makeTempDir({ dir: here, prefix: 'search-br-' });
  try {
    // Brotli-encoded "search-binary", generated independently of the runtime reader.
    const bytes = new Uint8Array([11,6,128,115,101,97,114,99,104,45,98,105,110,97,114,121,3]);
    const out = join(dir, 'otf-search');
    await write(`${out}.br`, bytes);
    const resolved = await otfSearchPath({ otfwc: join(dir, 'otfwc'), os: 'linux', environment: {} });
    expect(resolved).toBe(out);
    expect(await file(out).text()).toBe('search-binary');
    // Once extracted, the plain binary is reused.
    await remove(`${out}.br`);
    expect(await otfSearchPath({ otfwc: join(dir, 'otfwc'), os: 'linux', environment: {} })).toBe(out);
  } finally { await remove(dir, { recursive: true }); }
});
