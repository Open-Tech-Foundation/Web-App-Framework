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
across the whole process tree at 50 Hz. One run per cell. The two tables come from
separate sweeps, so the same tool's 72 KB cell differs by a few percent between
them (OTF Web reads 254 MB in one and 262 MB in the other) — that spread is the
run-to-run noise floor, and no claim here rests on a margin near it. See
[How reproducible is this?](#how-reproducible-is-this) before quoting any of it.

### At the real page size (72 KB)

| | peak RSS | wall |
|---|---|---|
| **OTF Web** | **254 MB** | **0.50 s** |
| Vite (no client bundle) | 260 MB | 0.77 s |
| Astro (no client bundle) | 416 MB | 1.23 s |
| TanStack Start | 510 MB | 1.96 s |
| Next.js | 1226 MB | 3.78 s |

### As one page grows

Peak RSS / wall time, one run per size. `SIGSEGV` is a hard crash, not a slow
build.

| | 72 KB | 145 KB | 289 KB | 578 KB | 1.2 MB | 2.3 MB |
|---|---|---|---|---|---|---|
| OTF Web (0.12, no SSG fold) | 312 MB / 0.6 s | **SIGSEGV** | **SIGSEGV** | **SIGSEGV** | — | — |
| OTF Web (0.13, SSG fold only) | 268 / 0.5 | 320 / 0.8 | 375 / 1.4 | 604 / 3.9 | 867 / 10.3 | 1720 / 47.2 |
| **OTF Web (current)** | 262 / 0.5 | 300 / 0.6 | 394 / 1.0 | 497 / 2.2 | 779 / 5.3 | **1320 / 15.1** |
| Astro | 395 / 5.8 † | 417 / 1.2 | 484 / 1.4 | 555 / 1.6 | 592 / 2.2 | 943 / 3.7 |
| Vite | 260 / 0.7 | 332 / 0.9 | 424 / 1.3 | 581 / 2.2 | 840 / 4.0 | 1490 / 8.6 |
| TanStack Start | 507 / 1.6 | 546 / 2.1 | 606 / 3.0 | 990 / 4.9 | 1485 / 9.0 | 2022 / 19.0 |
| Next.js | 1252 / 3.6 | 1343 / 4.1 | 1457 / 5.0 | 1666 / 7.3 | 2069 / 13.1 | 2977 / 31.3 |

† Cold-cache first run — 1.1 s warm. Single runs, so read the shape of each row
rather than its individual cells.

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

**The second fix: not walking into static markup.** The crash fix left a separate
problem — 47 s to build a 2.3 MB page, the slowest of the five. The build log
billed 40.6 s of that to "Compiling routes & components", and the cause was the
hydrate backend's output size: 29.8 MB of JS for a 2.3 MB page, which the bundler
then had to parse. It emitted a `cursor` plus a `claimElement`/`skipNode` per node
even through markup that cannot change, though claiming an element already
advances the cursor past its whole subtree. Skipping the walk for static subtrees
took the adopt path from ~72,000 emitted lines to ~2,950 and the module from
29.8 MB to 19.8 MB — and since the bundler's cost grows faster than linearly with
input, a 34% smaller module made the build **3.5× faster**.

**Where we stand, and where we don't.** At real docs-page sizes we are the
fastest and leanest here — while building a hydration bundle neither Vite nor
Astro produces. At 2.3 MB we are third on time and second on memory, ahead of
both TanStack Start and Next.js; before the second fix we were last on time, and
by a wide margin.

**Astro still builds that page 4× faster** (3.7 s against 15.1 s). What is left is
the CSR build path — a `document.createElement` per node, which the hydrate module
carries as its rebuild fallback and which is now most of the remaining 19.8 MB.
Emitting static subtrees as cloned templates would close much of the gap. It is not
done here because `template.innerHTML` re-parses markup and the HTML parser
restructures invalid nesting (a `<p>` wrapping a block element gets hoisted out)
where `createElement` does not — so it changes CSR rendering for every app, not
just large pages, and deserves its own verification pass.

## How reproducible is this?

Be precise about what these numbers are, because "we measured it" and "you can
check it" are different claims.

**Reproducible today:** the *method*. The harness and the fixture generator are
committed, the fixture is a public file at a named commit, every project's
configuration is written out below, and the measured quantity — peak RSS of the
whole process tree — is defined by code you can read rather than by a claim.

**Not reproducible today:** the *exact table*, from a single command. Three gaps:

1. **The five projects are not vendored.** You rebuild them from the notes below.
2. **Dependency versions float.** They were installed with plain `npm i`, so a run
   next month resolves different versions. The majors used are in the table above.
3. **The compiler is a local build.** The "current" row is `cargo build --release`
   at the commit that added the static-subtree fix, not a published version.

So treat the table as *evidence*, not proof: independently checkable, but not yet
byte-for-byte replayable. Closing the gap means vendoring the five project
skeletons with lockfiles and adding a runner — worth doing before quoting these
numbers anywhere outside this repo.

**One check that has been done.** The whole set was rebuilt from scratch in a
second, independent session and the four non-otfw tools landed within a few
percent of the first run — Astro 946→943 MB / 3.4→3.7 s, Vite 1489→1490 MB /
8.2→8.6 s, TanStack 2043→2022 MB / 18.4→19.0 s, Next.js 3125→2977 MB / 30.2→31.3 s
at 2.3 MB. Different `node_modules`, same machine and fixture. That is the
strongest evidence available short of a pinned runner: the measurements are stable
and not an artifact of one setup.

## Reproducing

The fixture is `website/app/spec/page.mdx` from
[Open-Tech-Foundation/STF](https://github.com/Open-Tech-Foundation/STF) at commit
`12468ad` (CC0 1.0). Any later revision works — it just stops being the same
fixture, so record which one you used.

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
