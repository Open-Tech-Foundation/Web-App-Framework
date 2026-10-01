import { expect, test } from 'runtime:test';
import { build } from 'runtime:build';
import { mkdir, symlink } from 'runtime:fs';
import { join, toFileURL } from 'runtime:path';
import { resolveFrom } from '../src/runtime.js';
import { discard, tempDir, writeTree } from './fixture.js';

test('symlinked package aliases and relative imports share the same runtime state', async () => {
  const root = await tempDir('otfw-package-resolution');
  try {
    const installed = join(root, 'store/runtime');
    await writeTree(root, {
      'package.json': '{"type":"module"}',
      'store/runtime/package.json': '{"name":"@fixture/runtime","type":"module","exports":{".":"./index.js","./server":"./server.js"}}',
      'store/runtime/state.js': 'export const routes = [];',
      'store/runtime/index.js': 'import { routes } from "./state.js"; export const register = route => routes.push(route);',
      'store/runtime/server.js': 'import { routes } from "./state.js"; export const collect = () => routes;',
      'entry.js': 'import { register } from "@fixture/runtime"; import { collect } from "@fixture/runtime/server"; register("/docs"); export const routes = collect();',
    });
    await mkdir(join(root, 'node_modules/@fixture'), { recursive: true });
    await symlink(installed, join(root, 'node_modules/@fixture/runtime'), { type: 'dir' });
    const entry = await resolveFrom('@fixture/runtime', root);
    const server = await resolveFrom('@fixture/runtime/server', root);
    expect(entry).toBe(join(installed, 'index.js'));
    expect(server).toBe(join(installed, 'server.js'));
    const bundle = await build({ input: join(root, 'entry.js'), resolve: {
      alias: { '@fixture/runtime/server': server, '@fixture/runtime': entry },
    } });
    try { await bundle.write({ dir: join(root, 'out'), format: 'esm', entryFileNames: 'entry.js' }); }
    finally { await bundle.close(); }
    const result = await import(toFileURL(join(root, 'out/entry.js')).href);
    expect(result.routes).toEqual(['/docs']);
  } finally { await discard(root); }
});
