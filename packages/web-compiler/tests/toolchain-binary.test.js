import { expect, test } from 'runtime:test';
import { file, makeTempDir, mkdir, remove, write } from 'runtime:fs';
import { dirname, fromFileURL, join } from 'runtime:path';
import { otfwcPath } from '../index.js';
const here = dirname(fromFileURL(import.meta.url));

test('one toolchain binary resolves overrides and platform-specific package paths', async () => {
  const dir = await makeTempDir({ dir: here, prefix: 'toolchain-bin-' });
  try {
    const override = join(dir, 'custom-toolchain');
    await write(override, 'override');
    expect(await otfwcPath({ environment: { OTFWC_BIN: override } })).toBe(override);
    await mkdir(join(dir, 'bin/win32-x64'), { recursive: true });
    const windows = join(dir, 'bin/win32-x64/otfwc.exe');
    await write(windows, 'windows');
    expect(await otfwcPath({ binaryDir: dir, os: 'windows', cpuArch: 'x86_64', environment: {} })).toBe(windows);
    let error;
    try { await otfwcPath({ environment: { OTFWC_BIN: join(dir, 'missing') } }); } catch (e) { error = e; }
    expect(error.message).toContain('OTFWC_BIN');
  } finally { await remove(dir, { recursive: true }); }
});

test('the unified toolchain lazily decompresses and reuses its single archive', async () => {
  const dir = await makeTempDir({ dir: here, prefix: 'toolchain-br-' });
  try {
    // Independently encoded fixture payload; extraction is shared by compilation and indexing.
    const bytes = new Uint8Array([11,6,128,115,101,97,114,99,104,45,98,105,110,97,114,121,3]);
    await mkdir(join(dir, 'bin/linux-x64'), { recursive: true });
    const out = join(dir, 'bin/linux-x64/otfwc');
    await write(`${out}.br`, bytes);
    const options = { binaryDir: dir, os: 'linux', cpuArch: 'x86_64', environment: {} };
    expect(await otfwcPath(options)).toBe(out);
    expect(await file(out).text()).toBe('search-binary');
    await remove(`${out}.br`);
    expect(await otfwcPath(options)).toBe(out);
  } finally { await remove(dir, { recursive: true }); }
});
