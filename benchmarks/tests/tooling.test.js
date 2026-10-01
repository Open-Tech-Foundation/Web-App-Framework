import { expect, test } from 'runtime:test';
import { file, makeTempDir, mkdir, remove, write } from 'runtime:fs';
import { dirname, fromFileURL, join } from 'runtime:path';
import { env } from 'runtime:process';
import { Command } from 'runtime:system';
const root = dirname(dirname(dirname(fromFileURL(import.meta.url))));
const executable = env.ESDEV_BIN || 'esdev';

async function run(script, args) {
  const result = await new Command(executable, { args: [join(root, script), ...args], cwd: root, inheritEnv: true }).output();
  if (!result.success) throw Error(new TextDecoder().decode(result.stderr));
}

test('native benchmark fixture generator preserves frontmatter and body separators', async () => {
  await mkdir(join(root, '.cache'), { recursive: true });
  const tmp = await makeTempDir({ dir: join(root, '.cache'), prefix: 'benchmark-ladder-' });
  try {
    const source = join(tmp, 'source.mdx');
    const header = '---\ntitle: Fixture\n---', body = '\n# Body\n\n---\nKeep this rule.\n';
    await write(source, header + body);
    await run('benchmarks/ssg-build/make-ladder.mjs', [source, tmp]);
    expect(await file(join(tmp, 'spec-1x.mdx')).text()).toBe(header + body);
    expect(await file(join(tmp, 'spec-32x.mdx')).text()).toBe(header + body.repeat(32));
  } finally { await remove(tmp, { recursive: true }); }
});

test('native report aggregation pools samples and respects the timing resolution', async () => {
  await mkdir(join(root, '.cache'), { recursive: true });
  const tmp = await makeTempDir({ dir: join(root, '.cache'), prefix: 'benchmark-report-' });
  try {
    const first = join(tmp, 'first.json'), second = join(tmp, 'second.json'), out = join(tmp, 'report.json');
    const record = (values) => ({ engines: ['otfw', 'react'], results: values.map((samples, i) => ({ engine: ['otfw', 'react'][i], cases: [{ label: 'create', samples, median: samples[0] }] })) });
    await write(first, JSON.stringify(record([[10, 20], [100, 110]])));
    await write(second, JSON.stringify(record([[30, 40], [120, 130]])));
    await run('benchmarks/aggregate.mjs', [first, second, `--out=${out}`]);
    const result = await file(out).json();
    expect(result.runs).toBe(2);
    expect(result.rows[0].values).toEqual({ otfw: 25, react: 115 });
    expect(result.rows[0].best).toBe('otfw');
    await write(second, JSON.stringify(record([[10, 20], [11, 21]])));
    await run('benchmarks/aggregate.mjs', [second, `--out=${out}`]);
    expect((await file(out).json()).rows[0].best).toBeNull();
  } finally { await remove(tmp, { recursive: true }); }
});
