# esdev migration status

Verified on 2026-10-07 against **esdev 0.17.0** and Chromium 153. The migration
inside this repository is complete, and every upstream esdev issue found during it
is fixed in 0.17. For esdev behavior, the official docs at
[esrun.opentechf.org](https://esrun.opentechf.org/) are the reference.

## Working in this repository

- Development, builds, tests, typechecking, benchmarks and the site build run
  through `tsr` tasks that call esdev (`tasks.toml`). Bun, happy-dom and the
  retired `otfw` CLI are no longer used by the framework packages.
- `@opentf/esdev-plugin-web` compiles JSX/TSX/MDX through `otfwc` and generates
  the `@otfw/routes` module; esdev owns bundling, CSS, HMR transport and serving.
- `@opentf/web-cli` is only the SSG library (`@opentf/web-cli/ssg`): the
  prerender driver for a `then: "run"` target and the release-only
  `siteOutputPlugin` that writes search, feeds and LLM files.
- The comparison benchmarks (`benchmarks/{react,solid,svelte}`) keep their own
  Bun build scripts; OTF orchestration and aggregation run on esdev.

Checks run for this verification:

| Check | Result |
| --- | --- |
| `tsr typecheck` | Pass |
| `tsr test` (Rust + native/DOM suites, including userEvent under `--dom`) | Pass |
| `tsr test-e2e-hmr` (component refresh, compile-error recovery) | Pass |
| `tsr test-e2e-docs-hydration` | Pass: 126 checks |
| `tsr site-build` with the checkout's `@opentf/web` | Pass: 65 pages prerendered, 63 indexed, feeds and LLM files |

## Upstream esdev issues (resolved in 0.17)

| Issue | Seen in | Fix | Regression coverage here |
| --- | --- | --- | --- |
| `esdev start` panicked in Rolldown's incremental cache after a plugin transform error was fixed | 0.15, 0.16 | 0.17 | `tsr test-e2e-hmr` breaks and fixes the active page |
| Native `--dom` realm lacked an extensible `navigator` and input selection, so `userEvent.setup()`/`type()` failed | 0.14–0.16 | 0.17 ([DOM realm](https://esrun.opentechf.org/esdev/test/dom)) | The userEvent suite runs in `tsr test-web-test` and the browser tier |
| `new URL("./file", import.meta.url)` assets were not emitted | 0.15, 0.16 | 0.17 ([files named by URL](https://esrun.opentechf.org/esdev/build/browser#files-named-by-url)) | Site [Assets guide](https://web.opentechf.org/docs/core-concepts/assets) |
| `esdev preview` answered every missing route with `index.html` and 200, ignoring `404.html` | 0.16 | 0.17: 404 + `404.html`; `--spa` opts into the fallback ([Preview](https://esrun.opentechf.org/esdev/start/preview)) | SPA starters use `esdev preview --spa` |
| Fullstack starter needed an `HTMLElement` bootstrap | 0.16 | 0.17 template targets `server.js` (with `@opentf/web` 0.31) | `packages/web/server/index.test.js` loads the server entry with no DOM |
| Route chunks imported an unhashed `entry.js` in production builds | 0.14, 0.15 | 0.16 | `tsr bench -- otfw`, site build |

## Pending in this repository

- **Website dependencies.** `website/` is ready to move to web 0.31, web-docs 0.29,
  plugin 0.4 and CLI 1.29, but published `@opentf/web` 0.31.0 fails its prerender:
  server builds resolve page imports to `@opentf/web/server`, which lacked
  `setLocale` (fixed here, unreleased). Update the site after the next `@opentf/web`
  release.

## Framework follow-ups

- Original Markdown/MDX source maps (current maps target generated JSX).
- MDX 404 routes are rejected; use `404.jsx`/`404.tsx`.
- SSG omits spread attributes and multi-node roots (warned during builds).
- Benchmarks: the published tables predate the migration. Re-run all four engines
  under the same conditions before replacing them.

## Component refresh

`tsr test-e2e-hmr` drives the browser check (state, effects, refs, slots, route
refresh and reload fallbacks). Behavior and limits are described in the
[plugin README](../packages/esdev-plugin-web/README.md#development-refresh).
