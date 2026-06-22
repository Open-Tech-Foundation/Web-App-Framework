# Benchmarks

Performance benchmark suite for OTF Web. The goal is the comparison promised in
the root README: OTF Web vs. other frameworks across **rendering**, **update
latency**, and (later) **memory**.

> **Status:** four cases run through one harness — **OTF Web**, **React**,
> **Solid**, and **Svelte 5** — with an automated runner and a side-by-side
> comparison. Timing is still the double-`rAF` proxy (see the caveat below);
> tracing-based timing is the next step.

## Methodology

We follow the de-facto industry standard, the
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
("krausest") operation set, so numbers are comparable to published results:

| Case | What it measures |
|------|------------------|
| create 1,000 rows | building a moderate keyed list from empty |
| create 10,000 rows | building a large keyed list from empty |
| append 1,000 to 1,000 | appending to a populated list |
| update every 10th row | partial update (reactive write, no structural change) |
| swap 2 rows | minimal keyed reorder (rows 1 ↔ 998) |
| select row | single-row reactive class change |
| remove row | single-row removal from a 1,000-row list |
| clear 10,000 rows | tearing down a large list |

Each row is `{ id, label }` with a random `adjective colour noun` label, exactly
as in the reference benchmark.

### How timing works

Each operation is measured **in real time** (not Chrome virtual time, which
would distort `performance.now`). For one sample we:

1. establish the precondition (e.g. build a 1,000-row list),
2. wait one frame so the precondition has painted,
3. record `performance.now()`, perform the operation (a synchronous reactive
   write — OTF Web flushes synchronously), then
4. wait for the **next painted frame** (double `requestAnimationFrame`) and
   record the elapsed time.

We take several samples per operation and report the **median**.

> **Honest limitation — read before quoting any number.** Double-`rAF` measures
> _time to the next frame_, a close proxy for paint but not the reference
> benchmark's Chrome-tracing `paint`-event methodology. Crucially it is
> **frame-quantized**: the floor is one frame (~16.6 ms at 60 Hz), so a 1-node
> update and a 50-node update can both report ~33 ms (two frames) and look
> identical. Differences _smaller than a frame are invisible_ — which is most of
> the interesting gap between fine-grained frameworks on single-row operations.
>
> So today's output is good for: ranking the **expensive** operations (create
> 10k, clear), catching whole-frame regressions, and confirming the harness is
> fair across engines. It is **not** good for sub-frame single-row comparisons,
> and is **not** a publishable head-to-head. The tracing-based driver (Roadmap
> #2) removes the frame floor; until then, treat everything here as
> **indicative**.

## Running

From the repo root:

```bash
bun run bench                      # the OTF Web case, headless, with a table
bun run bench react                # a single sibling case
bun run bench otfw react solid svelte   # several cases + a comparison table
bun run bench all                  # every case directory, compared
bun run bench -- --headful         # watch it run in a real browser window
bun run bench -- --no-build        # reuse existing dist/ (skip the compile step)
```

With more than one case the runner appends a side-by-side comparison (median per
operation, fastest in **bold**) and writes a `comparison-<timestamp>.json`.

The runner (`benchmarks/run.mjs`) is dependency-free: it builds the case with the
normal `otfw` toolchain, serves `dist/`, drives a headless Chrome/Chromium over
the DevTools Protocol (no Playwright/Puppeteer install), collects the in-page
results, writes `benchmarks/results/<case>-<timestamp>.json`, and prints a
Markdown table.

### Manual run (no runner)

```bash
cd benchmarks/otfw
bun run dev            # then open http://localhost:3010
```

Click **▶ Run all (measured)**, or load `http://localhost:3010/?autorun` to run
the suite automatically. Results render on the page and are written to
`window.__BENCH_RESULTS__`.

## Layout

```
benchmarks/
  README.md         ← this file
  run.mjs           ← dependency-free CDP runner (build → serve → drive → compare)
  results/          ← JSON result files (git-ignored)
  otfw/             ← OTF Web implementation (a real app, built by `otfw`)
    index.html
    app/page.jsx    ← the benchmark component + in-page harness
    app/_bench.js   ← pure helpers (row data, median, frame waiting)
  react/            ← React 19 (Bun bundler, production build)
    build.mjs · src/main.jsx · src/_bench.js · global.css
  solid/            ← Solid (babel-preset-solid via a Bun plugin)
    build.mjs · src/main.jsx · src/_bench.js · global.css
  svelte/           ← Svelte 5 runes (svelte compiler via a Bun plugin)
    build.mjs · src/main.js · src/App.svelte · src/_bench.js · global.css
```

Each non-OTF case carries its own `build.mjs` (the OTF case uses the real `otfw`
toolchain) and a verbatim copy of `_bench.js`. The runner is engine-agnostic: it
only relies on the in-page contract below.

## Adding a framework

Each framework is a sibling directory under `benchmarks/` that implements the
**same operation set** and exposes the **same in-page contract** so one runner
drives them all:

- on `?autorun`, run every case and then set
  - `window.__BENCH_RESULTS__ = { engine, ua, cases: [{ label, median, runs }] }`
  - `window.__BENCH_DONE__ = true`
- use the identical row shape, counts, sample counts, and the double-`rAF`
  timing helper (copy `app/_bench.js`).

Then `bun run bench <name>` runs it. Keep the DOM structure (a single `<table>`
of rows) equivalent across cases so the comparison is apples-to-apples.

## Roadmap

1. ~~**React / Svelte / Solid** sibling cases~~ — _done_ (same harness, same
   machine, same timing).
2. **Tracing-based timing** — drive Chrome tracing for true `paint`-event
   latency, replacing the double-`rAF` proxy. This removes the frame-quantization
   floor that currently hides sub-frame single-row differences, and is the
   prerequisite for any publishable number.
3. **Memory** — heap snapshots after _create 10k_ / _clear_ via CDP
   `HeapProfiler`.
4. **Startup / bundle size** — measure shipped JS per case (compiler output is a
   first-class differentiator for OTF Web).
5. **CI regression gate** — fail a PR if any median regresses beyond a threshold
   vs. a committed baseline.
</content>
</invoke>
