import { expect, test } from '../../web-cli/tests/harness.js';
import { file, makeTempDir, mkdir, remove, write } from 'runtime:fs';
import { dirname, fromFileURL, join } from 'runtime:path';
import { env, platform } from 'runtime:process';
import { Command } from 'runtime:system';
import { createSearch } from '../search.js';

const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));
const binary = env.OTF_SEARCH_BIN || join(root, 'target', 'debug', platform === 'windows' ? 'otf-search.exe' : 'otf-search');

test('the Rust writer and JS reader agree on content, metadata, and deployment generations', async () => {
  await mkdir(join(root, '.cache'), { recursive: true });
  const site = await makeTempDir({ dir: join(root, '.cache'), prefix: '.otf-search-test-' });
  const original = globalThis.fetch;
  const build = async () => {
    const result = await new Command(binary, { args: ['build', site], stdout: 'piped', stderr: 'piped' }).output();
    if (!result.success) throw Error(new TextDecoder().decode(result.stderr));
  };
  globalThis.fetch = async (url) => {
    try { return new Response(await file(join(site, String(url).replace(/^\//, ''))).arrayBuffer()); }
    catch { return new Response(null, { status: 404 }); }
  };
  try {
    await write(join(site, 'index.html'), '<main data-otf-search-body><h1>Guide &amp; Reference</h1><p>😀 café</p><h2 id="routing">Routing</h2><p>route.<em>params</em> Alpha</p><span data-otf-search-ignore>IgnoreSentinel</span></main><p>OutsideSentinel</p><nav data-otf-search-meta="breadcrumb">Docs &amp; Guides</nav>');
    await write(join(site, '404.html'), '<main>Not searchable</main>');
    await build();
    const old = createSearch();
    const result = await old.query('route.params');
    expect(result.partial).toBe(false);
    expect(result.results[0].title).toBe('Guide & Reference');
    expect(result.results[0].meta.breadcrumb).toBe('Docs & Guides');
    expect(result.results[0].text.includes('route.params')).toBe(true);
    expect((await old.query('IgnoreSentinel')).total).toBe(0);
    expect((await old.query('OutsideSentinel')).total).toBe(0);
    expect((await old.query('café')).partial).toBe(false);
    const pos = result.results[0].anchors[0].pos;
    expect(result.results[0].text.slice(pos, pos + 7)).toBe('Routing');
    await write(join(site, 'index.html'), '<main data-otf-search-body><h1>New guide</h1><p>Beta</p></main>');
    await build();
    // The old client uses its complete old generation, never new fragments with old IDs.
    expect((await old.query('Alpha')).results[0].title).toBe('Guide & Reference');
    expect((await createSearch().query('Beta')).results[0].title).toBe('New guide');
  } finally {
    globalThis.fetch = original;
    await remove(site, { recursive: true });
  }
});
