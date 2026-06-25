# @opentf/web-cli

## [Unreleased]

### Added

- `docs.sections` (a list of content folders) registers the nav generator for every
  section and includes them all in the last-updated/edit-link scan, so additional doc
  sections (e.g. `/api`) get the same treatment as the main docs from one switch.
- `otfw build` / `otfw dev` register the `@opentf/web-docs` last-updated plugin when a
  section opts in (`docs.lastUpdated` / `blog.lastUpdated`), resolving
  `@opentf/web-docs/updated` to the per-page git/frontmatter timestamp map. During SSG,
  `runLastUpdated` builds the same map and `runPrerender` injects an
  `article:modified_time` meta tag into each page that has one.
- `otfw build` generates the blog RSS feed. When a project has a `blog` block and a
  base URL (`--base-url` or `site.url`), `runBlogFeed` scans the posts via
  `@opentf/web-docs/build` and writes `dist/<blogDir>/rss.xml` after the `public/` copy
  (so a project-supplied feed override isn't clobbered). Skipped with a warning when no
  base URL is set.

### Fixed

- `otfw dev` static serving now skips directories. A request whose path is also a
  directory under `public/` (e.g. the route `/blog` when `public/blog/` holds post
  assets) tried to `readFileSync` the directory and threw `EISDIR`; it now falls
  through to the SPA shell, and real files under that directory still serve.

### Changed

- Register the blog posts plugin alongside the docs nav plugin. `loadDocsNavPlugin`
  becomes `loadDocsPlugins`, returning every active `@opentf/web-docs` build plugin —
  the nav generator when `docs` is configured and the post-list generator when `blog`
  is — so `@opentf/web-docs/posts` resolves in dev, build, and SSG.

- `otfw dev` is now on-demand (Vite-style): nothing is compiled at startup. The
  runtime (`@opentf/web`) is bundled once on first request and shared by every chunk
  through an import map; the entry's route loaders point at `/__route/<id>.js` URLs;
  and each route (page or layout) compiles the first time it's visited, then caches.
  The module graph (`otfwc graph`) drives HMR — a file change drops only the cached
  chunks whose dependency subgraph reaches it (its `affected` set), so an unrelated
  route stays warm. On the docs site startup drops from ~16.7s to ~40ms; a route's
  first visit costs ~30–400ms and is then served from cache in well under a
  millisecond. `otfw build` is unchanged (eager Rolldown bundle).
- `otfw dev` / `otfw build` now compile every module through a single long-lived
  `otfwc serve` process instead of spawning `otfwc build` per file. The toolchain pays
  the compiler-binary startup cost once, which is the dominant dev-server start cost —
  on the docs site the initial bundle drops from ~16.7s to ~3.1s and incremental
  rebuilds to well under a second. The child is `unref`'d (so one-shot builds still
  exit promptly) and torn down on process exit.

## 1.0.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.

### Patch Changes

- Updated dependencies [bb1c71b]
  - @opentf/web@0.5.0
  - @opentf/web-compiler@0.1.0
