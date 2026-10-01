import { expect, test } from 'runtime:test';
import { file, makeTempDir, mkdir, readDir, remove, write } from 'runtime:fs';
import { basename, dirname, fromFileURL, join } from 'runtime:path';
import { env } from 'runtime:process';
import { Command } from 'runtime:system';
const root = dirname(dirname(dirname(fromFileURL(import.meta.url))));

test('native runner serves browser modules, records results, and fails promptly on page errors', async () => {
  await mkdir(join(root, '.cache'), { recursive: true });
  const tmp = await makeTempDir({ dir: join(root, '.cache'), prefix: 'benchmark-runner-' });
  const engine = basename(tmp);
  const caseName = `../.cache/${engine}`;
  const executable = env.ESDEV_BIN || 'esdev';
  const run = () => new Command(executable, {
    args: [join(root, 'benchmarks/run.mjs'), caseName, '--no-build', '--throttle=1'],
    cwd: root, inheritEnv: true, timeout: 15000,
  }).output();
  try {
    await mkdir(join(tmp, 'dist/assets'), { recursive: true });
    await write(join(tmp, 'package.json'), '{"type":"module"}');
    await write(join(tmp, 'dist/assets/result.js'), `export const result = { engine: ${JSON.stringify(engine)}, cases: [{ label: 'fixture', median: 12, runs: 3, samples: [11, 12, 13] }] };`);
    await write(join(tmp, 'dist/index.html'), '<script type="module">import { result } from "./assets/result.js"; window.__BENCH_RESULTS__ = { ...result, ua: navigator.userAgent }; window.__BENCH_DONE__ = true;</script>');
    const good = await run();
    if (!good.success) throw Error(new TextDecoder().decode(good.stderr));
    const files = await readDir(join(root, 'benchmarks/results'));
    const report = files.find(entry => entry.name.startsWith(`${engine}-`));
    expect(Boolean(report)).toBe(true);
    const result = await file(join(root, 'benchmarks/results', report.name)).json();
    expect(result.engine).toBe(engine);
    expect(result.throttle).toBe(1);
    expect(result.cases[0].samples).toEqual([11, 12, 13]);
    await write(join(tmp, 'dist/index.html'), '<script>throw Error("fixture page failure")</script>');
    const bad = await run();
    expect(bad.success).toBe(false);
    expect(new TextDecoder().decode(bad.stderr)).toContain('fixture page failure');
  } finally {
    await remove(tmp, { recursive: true });
    for (const entry of await readDir(join(root, 'benchmarks/results'))) {
      if (entry.name.startsWith(`${engine}-`)) await remove(join(root, 'benchmarks/results', entry.name));
    }
  }
});
