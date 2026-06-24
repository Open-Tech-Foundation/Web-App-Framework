# @opentf/web-cli

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Added

- The toolchain now resolves and compiles `.mdx`/`.md` modules (through `otfwc`'s MDX
  front-end), so Markdown/MDX routes build like `.jsx`/`.tsx`.
- SSG build pass: injects per-route `<head>` (from each route's resolved metadata),
  pre-renders dynamic routes, and emits `sitemap.xml` + `robots.txt` for the built site.
- Docs-site generator integration: a nav plugin builds the sidebar tree from the docs
  directory, dedups group landing pages, and honors route exclusions — driven by the
  project's `otfw.config.js` docs config (`@opentf/web-docs`).
- `otfw build` now reports its phases. Each phase — compiling routes & components,
  pre-rendering pages, building the search index — shows an animated spinner with live
  detail (the current file, or an `N/total` count) on a TTY, then collapses to a green
  ✅ line with the elapsed time; the run ends with `→ dist/ ready in …`. On a
  non-interactive stream the spinners are skipped and only the ✅/✗ lines print, so logs
  stay clean. (Implemented in `src/reporter.js`.)
- `otfw build --ssg` runs a docs search index pass when the project's docs config sets
  `search.provider: "pagefind"`: after pre-rendering, it indexes the searchable pages
  with Pagefind (via `@opentf/web-docs/build`'s `indexWithPagefind`) and reports the
  page count, with live `N/total pages` progress feeding the build's search phase. No-op
  for projects without docs search configured.

### Changed

- Silence Rolldown's `PLUGIN_TIMINGS` advisory during the build — the compiler runs a
  subprocess per file, so it dominates plugin time by design and the warning was noise.

### Fixed

- Dev server now serves `public/` assets (e.g. `/logo.png`), falling back to the
  `public/` directory the build copies to the dist root — so they no longer 404 in
  development.

## 1.0.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.

### Patch Changes

- Updated dependencies [bb1c71b]
  - @opentf/web@0.5.0
  - @opentf/web-compiler@0.1.0
