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
    await write(join(site, 'index.html'), '<main data-otf-search-body><h1>Guide &amp; Reference</h1><p>😀 café</p><h2 id="routing">Routing</h2><p>route.<em>params</em> Alpha</p><div class="otfw-code-head">JSX Copy</div><pre><code>&lt;div class="UniqueExampleToken"&gt;sample&lt;/div&gt;</code></pre><span data-otf-search-ignore>IgnoreSentinel</span></main><p>OutsideSentinel</p><nav data-otf-search-meta="breadcrumb"><web-raw-html><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script></web-raw-html><span>Docs</span><span>/</span><span>Guides</span><span hidden>HiddenMetadataNoise</span></nav>');
    await write(join(site, '404.html'), '<main>Not searchable</main>');
    await build();
    const old = createSearch();
    const result = await old.query('route.params');
    expect(result.partial).toBe(false);
    expect(result.results[0].title).toBe('Guide & Reference');
    expect(result.results[0].url).toBe('/#routing');
    expect(result.results[0].meta.breadcrumb).toBe('Docs / Guides');
    expect(result.results[0].text.includes('route.params')).toBe(true);
    expect(result.results[0].section).toBe('Routing');
    expect(result.results[0].excerpt.includes('<div')).toBe(false);
    expect(result.results[0].text.includes('JSX Copy')).toBe(false);
    expect((await old.query('UniqueExampleToken')).total).toBe(1);
    expect((await old.query('Copy')).total).toBe(0);
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

test('enabled indexing failures propagate instead of producing a successful SSG build', async () => {
  const { runDocsSearchIndex } = await import('../../web-cli/src/shared.js');
  expect(await runDocsSearchIndex(root, {}, '/missing-site', binary)).toBeNull();
  let error;
  try {
    await runDocsSearchIndex(root, { docs: { search: { provider: 'otf' } } }, join(root, '.cache', 'missing-search-site'), join(dirname(binary), platform === 'windows' ? 'otfwc.exe' : 'otfwc'));
  } catch (e) { error = e; }
  expect(Boolean(error)).toBe(true);
  expect(error.message).toContain('Search site directory does not exist');
});
