# SSG build benchmark

**What it measures:** the cost of *building* a static site — peak memory and wall
time for `otfw build --ssg` and the equivalent command in four other tools, all
rendering the **same** MDX page.

This is a **build-time** benchmark. It is unrelated to the runtime benchmark in
[`../README.md`](../README.md), which measures update latency in the browser.
Nothing here says anything about how fast a page runs once loaded.

## Why it exists

A 72 KB MDX page in a real docs site
([Open-Tech-Foundation/STF](https://github.com/Open-Tech-Foundation/STF/tree/main/website))
crashed `otfw build --ssg` once it grew past ~90 KB, and whole-site builds were
running out of memory. The cause was in our SSG code generator; the fix landed
after `@opentf/web-compiler` 0.12 (see its CHANGELOG). This benchmark is how we
confirmed the fix and checked our build cost against comparable tools — so it
stays honest, it is kept in the repo rather than written up once and thrown away.

## The fixture

One route rendering `spec.mdx` — the STF specification page: 72,354 bytes, 1751 lines,
54 headings, 43 fenced code blocks, 298 GFM table rows, and raw HTML/JSX blocks
with attributes. Real docs content, not synthetic markup.

The page is then scaled 1× → 32× (72 KB → 2.3 MB) by duplicating its body, so a
tool's behaviour can be watched as one page grows rather than at a single size.
Sites stay at **one page** so the numbers isolate per-page cost.

## What was compared

| Tool | Command | Ships client JS? |
|------|---------|------------------|
| **OTF Web** `@opentf/web-cli@1.23` | `otfw build --ssg` | yes — 574 KB hydration bundle |
| **Astro** 7.1 + `@astrojs/mdx` 7.0 | `astro build` | no — zero JS for a plain MDX page |
| **Next.js** 16.2 + `@next/mdx`, Turbopack | `next build` (`output: "export"`) | yes — 612 KB |
| **TanStack Start** 1.168 | `vite build` (prerender) | yes — 485 KB |
| **Vite** 8.1 + `@mdx-js/rollup` | SSR bundle + a prerender script | no |

**Read the last column before comparing anything.** Astro and Vite emit no
client bundle for these pages, so they are doing strictly less work than the
three tools that also build a hydration bundle. Vite is not an SSG framework at
all — it is the standard hand-rolled `renderToString` + prerender pattern,
included as a floor for "what does the underlying toolchain cost".

Two smaller asymmetries, both against us: OTF Web is the only tool that
syntax-highlights the code blocks (build-time `syntect`; the others produced no
highlight markup), and Next.js inlines an RSC payload the others have no
equivalent of.

Output parity was verified rather than assumed — all five emit the same
structure (288 `<table>`, 344 `<pre>`, 320 `<h2>` at 8×).

## Results

Intel i7-8700K (12 threads), 16 GB RAM, Linux 6.12, Node 24.14. Peak RSS sampled
across the whole process tree at 50 Hz.

### At the real page size (72 KB)

Best of 3 warm runs.

| | peak RSS | wall |
|---|---|---|
| **OTF Web** | 267 MB | **0.51 s** |
| Vite (no client bundle) | **259 MB** | 0.67 s |
| Astro (no client bundle) | 385 MB | 1.11 s |
| TanStack Start | 488 MB | 1.64 s |
| Next.js | 1227 MB | 3.57 s |

### As one page grows

Peak RSS / wall time, one run per size. `SIGSEGV` is a hard crash, not a slow
build.

| | 72 KB | 145 KB | 289 KB | 578 KB | 1.2 MB | 2.3 MB |
|---|---|---|---|---|---|---|
| OTF Web (0.12, pre-fix) | 312 MB / 0.6 s | **SIGSEGV** | **SIGSEGV** | **SIGSEGV** | — | — |
| OTF Web (with the fix) | 268 / 0.5 | 320 / 0.8 | 375 / 1.4 | 604 / 3.9 | 867 / 10.3 | 1720 / 47.2 |
| Astro | 395 / 5.8 † | 417 / 1.2 | 484 / 1.4 | 555 / 1.6 | 592 / 2.2 | 946 / 3.4 |
| Vite | 260 / 0.7 | 332 / 0.9 | 424 / 1.3 | 581 / 2.2 | 840 / 4.0 | 1489 / 8.2 |
| TanStack Start | 507 / 1.6 | 546 / 2.1 | 606 / 3.0 | 990 / 4.9 | 1485 / 9.0 | 2043 / 18.4 |
| Next.js | 1252 / 3.6 | 1343 / 4.1 | 1457 / 5.0 | 1666 / 7.3 | 2069 / 13.1 | 3125 / 30.2 |

† Cold-cache first run — 1.1 s warm, which is why the table above uses best of 3.
Single runs are kept here so the ladder is one uninterrupted sweep per tool; read
the shape of each row, not its individual cells.

## What the numbers say

**The crash was ours, and it is fixed.** Pre-fix, we died at 145 KB. Every other
tool absorbed 2.3 MB — 16× more — without crashing. This was never an
industry-wide limit on large pages; it was a defect in one code path.

**Why we crashed, structurally.** For the same 72 KB page:

| Generated JS | longest `+` chain | paren nesting | `_jsx()` calls |
|---|---|---|---|
| OTF Web SSG (pre-fix) | **12,206** | 4 | — |
| OTF Web SSG (fixed) | 81 | 4 | — |
| `@mdx-js/mdx` | 0 | 18 | 2,975 |

`@mdx-js/mdx` emits a tree of function calls whose depth (18) is the document's
**HTML depth**. Pre-fix, we emitted a chain of string concatenations whose depth
(12,206) was the document's **length**. Depth set by structure is bounded; depth
set by length overflows a recursive-descent parser once the page is big enough.
The fix folds adjacent static markup into single literals, moving us into the
first regime.

This also settles a question worth recording: **output streaming would not have
helped.** None of these tools streams SSG output — Astro writes complete files
exactly as we do, and it is the fastest at scale. The cost lived in parsing the
*generated program*, not in holding the *rendered HTML*.

**Where we stand, and where we don't.** At real docs-page sizes we are the
fastest here and second-leanest, behind only Vite's no-client-bundle floor —
while building a hydration bundle neither Vite nor Astro produces. That lead
holds to roughly 300 KB. **Astro overtakes us from ~580 KB upward**, and our
**wall time degrades superlinearly on very large single pages** — 47 s at 2.3 MB
against Astro's 3.4 s. That is not the SSG path: the build log bills 40.6 s of it to
"Compiling routes & components", and the cause is the hydrate backend's output
size — 29.8 MB of JS for a 2.3 MB page, against 5.4 MB from the SSG backend —
which the bundler must then parse. Tracked as a known limitation; it does not
bite at the page sizes real docs sites use.

## Reproducing

`measure.py` is the harness — it runs a command, samples peak RSS across the
process tree, and reports wall time:

```bash
python3 measure.py <label> <outdir> -- <command...>
# → {"label": "...", "exit": 0, "peak_mb": 267.5, "wall_s": 0.51}
```

`make-ladder.mjs` writes the 1×…32× fixtures from a source `.mdx`:

```bash
node make-ladder.mjs path/to/spec.mdx ./out   # writes spec-1x.mdx … spec-32x.mdx
```

The five projects are not vendored — each needs its own `node_modules`, and
pinning five toolchains in this repo would rot faster than it would help. Create
them from the table above (one route importing the fixture, defaults everywhere
else), then measure each build. Points worth knowing if you rebuild the set:

- **Next.js** — Turbopack requires *serializable* MDX plugin options, so remark
  plugins must be named as bare strings (`remarkPlugins: ["remark-gfm"]`), not
  imported functions.
- **TanStack Start** — the router module must export `getRouter`, not
  `createRouter`.
- Run the projects on **real disk**. A `tmpfs` scratch directory is charged to
  RAM and corrupts the memory measurement.
- Discard the first run of each project; cold dependency-optimization caches cost
  seconds (Astro's first 72 KB build took 5.8 s against 1.1 s warm).
