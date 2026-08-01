#!/usr/bin/env bun
// Pool several `bun run bench all` runs into one website report.
//
//   bun benchmarks/aggregate.mjs results/comparison-A.json results/comparison-B.json …
//   bun benchmarks/aggregate.mjs --latest 3        # the N newest comparison files
//
// Why this exists: one run's per-operation median moves enough between consecutive
// runs on an idle machine that the *fastest* label turns over. Three runs taken
// back to back picked three different winners for "create 1,000 rows" (svelte,
// solid, solid) — because otfw, Solid and Svelte sit within ~20 ms of each other
// there while the double-rAF quantum is 8.3 ms. Publishing any single run's
// bolding would be reporting a coin flip.
//
// So the site's table pools the raw samples of several runs and takes the median
// of the pool. That is the same median-over-samples statistic `run.mjs` already
// reports, with N≈30 instead of N≈10 — not a different method, just more data —
// and it applies the identical timing-resolution tie rule.
//
// Writes website/app/benchmark-report.json (the homepage table imports it) and
// prints per-cell diagnostics: each run's own median, and how far they spread.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, "results");
const OUT = join(HERE, "..", "website", "app", "benchmark-report.json");

// Must stay in step with run.mjs: double-rAF timing quantizes to frame
// boundaries, so medians closer than half a frame are indistinguishable.
const RESOLUTION_MS = 1000 / 60 / 2;

const argv = process.argv.slice(2);
let files;
const latestIdx = argv.indexOf("--latest");
if (latestIdx !== -1) {
  const n = Number(argv[latestIdx + 1]);
  if (!Number.isInteger(n) || n < 1) die("--latest needs a positive integer");
  files = readdirSync(RESULTS)
    .filter((f) => f.startsWith("comparison-") && f.endsWith(".json"))
    .sort()
    .slice(-n)
    .map((f) => join(RESULTS, f));
  if (files.length < n) die(`only ${files.length} comparison file(s) in ${RESULTS}`);
} else {
  files = argv;
}
if (files.length === 0) die("usage: aggregate.mjs <comparison.json…>  |  --latest <n>");

const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const engines = runs[0].engines;
const labels = runs[0].results[0].cases.map((c) => c.label);

for (const [i, run] of runs.entries()) {
  if (run.engines.join() !== engines.join()) {
    die(`${files[i]} has engines [${run.engines}], expected [${engines}]`);
  }
}

const rows = labels.map((label) => {
  const values = {};
  const diagnostics = {};
  for (const engine of engines) {
    const pooled = [];
    const runMedians = [];
    for (const run of runs) {
      const c = run.results
        .find((r) => r.engine === engine)
        ?.cases.find((x) => x.label === label);
      if (!c) continue;
      pooled.push(...c.samples);
      runMedians.push(round(c.median));
    }
    values[engine] = pooled.length ? round(median(pooled)) : null;
    diagnostics[engine] = { n: pooled.length, runMedians };
  }
  const ranked = engines
    .map((engine) => ({ engine, value: values[engine] }))
    .filter((e) => typeof e.value === "number")
    .sort((a, b) => a.value - b.value);
  const best =
    ranked.length >= 2 && ranked[1].value - ranked[0].value > RESOLUTION_MS
      ? ranked[0].engine
      : null;
  return { label, values, best, diagnostics };
});

writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: files.map((f) => "benchmarks/results/" + f.split("/").pop()),
      method: `Median of the pooled samples of ${runs.length} full runs (bun run bench all) on one machine.`,
      engines,
      highlightEngine: "otfw",
      resolutionMs: RESOLUTION_MS,
      runs: runs.length,
      rows: rows.map(({ label, values, best }) => ({ label, values, best })),
    },
    null,
    2,
  ) + "\n",
);

console.log(`pooled ${runs.length} runs → ${OUT}\n`);
for (const r of rows) {
  console.log(r.label);
  for (const e of engines) {
    const d = r.diagnostics[e];
    const lo = Math.min(...d.runMedians);
    const hi = Math.max(...d.runMedians);
    const swing = lo ? ((hi - lo) / lo) * 100 : 0;
    console.log(
      `   ${e.padEnd(7)} ${String(r.values[e]).padStart(8)}  n=${String(d.n).padStart(2)}` +
        `  per-run=[${d.runMedians.join(", ")}]  spread=${swing.toFixed(1)}%`,
    );
  }
  console.log(`   → ${r.best ?? "tie"}\n`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function round(n) {
  return Math.round(n * 100) / 100;
}
function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
