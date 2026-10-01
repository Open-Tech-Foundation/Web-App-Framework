import { expect, test } from 'runtime:test';
import { copy, file, makeTempDir, mkdir, remove, write } from 'runtime:fs';
import { dirname, fromFileURL, join } from 'runtime:path';
import { env, platform, arch } from 'runtime:process';
import { Command } from 'runtime:system';
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

for (const transitive of [false, true]) test(`a bundled prerender entry resolves the ${transitive ? 'transitive' : 'direct'} compiler archive`, async () => {
  const dir = await makeTempDir({ dir: here, prefix: 'toolchain-bundle-' });
  try {
    const pluginDir = join(dir, 'node_modules/@opentf/esdev-plugin-web');
    const packageDir = transitive ? join(pluginDir, 'node_modules/@opentf/web-compiler') : join(dir, 'node_modules/@opentf/web-compiler');
    await mkdir(packageDir, { recursive: true });
    if (transitive) {
      await write(join(pluginDir, 'package.json'), '{"name":"@opentf/esdev-plugin-web","type":"module","exports":"./index.js"}');
      await write(join(pluginDir, 'index.js'), 'export { otfwcPath } from "@opentf/web-compiler";');
    }
    for (const name of ['package.json', 'index.js', 'extract.js']) {
      await copy(join(here, '..', name), join(packageDir, name));
    }
    const os = { linux: 'linux', macos: 'darwin', windows: 'win32' }[platform];
    const cpu = { x86_64: 'x64', aarch64: 'arm64' }[arch];
    const binaryDir = join(packageDir, 'bin', `${os}-${cpu}`);
    await mkdir(binaryDir, { recursive: true });
    const binary = join(binaryDir, platform === 'windows' ? 'otfwc.exe' : 'otfwc');
    await write(`${binary}.br`, new Uint8Array([11,6,128,115,101,97,114,99,104,45,98,105,110,97,114,121,3]));
    await write(join(dir, 'package.json'), '{"type":"module"}');
    await write(join(dir, 'prerender.js'), `
import { otfwcPath } from '${transitive ? '@opentf/esdev-plugin-web' : '@opentf/web-compiler'}';
import { file } from 'runtime:fs';
const binary = await otfwcPath({ environment: {} });
console.log(JSON.stringify({ binary, payload: await file(binary).text() }));
`);
    await write(join(dir, 'esdev.json'), JSON.stringify({ build: { targets: {
      prerender: { entry: 'prerender.js', out: '.ssg/prerender.js', then: 'run' },
    } } }));
    const result = await new Command(env.ESDEV_BIN || 'esdev', {
      args: ['build'], cwd: dir, inheritEnv: true, timeout: 15000,
    }).output();
    if (!result.success) throw Error(new TextDecoder().decode(result.stderr));
    const line = new TextDecoder().decode(result.stdout).split('\n').find(line => line.startsWith('{'));
    const resolved = JSON.parse(line);
    expect(resolved.binary).toBe(binary);
    expect(resolved.payload).toBe('search-binary');
    expect(await file(binary).text()).toBe('search-binary');
  } finally { await remove(dir, { recursive: true }); }
});
