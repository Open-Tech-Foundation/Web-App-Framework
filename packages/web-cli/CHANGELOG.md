# @opentf/web-cli

## [Unreleased]

## [1.1.0] - 2026-07-01

### Added

- `nav` config threading (`docs/HYDRATION.md` §7): `entrySource` reads `otfw.config`'s
  `nav` and passes `nav: "mpa"` to `mountApp` when set, so an app can opt into full-page
  (MPA) navigation; the default stays SPA. Wired through both `otfw build` and `otfw dev`.
- Hydration toolchain wiring (Phase 2.0 — see `docs/HYDRATION.md` §3.4): the client
  bundle can now be built for the **hydrate** target so the server-rendered DOM is
  *adopted* on first paint instead of rebuilt. `runBuild({ hydrate })` requests
  `--target=hydrate` (the dual module — a CSR build factory plus a `hydrate` adopt
  factory per route) and stamps `data-otfw-hydrate` on the shell's `#app` via
  `stampHydrateSentinel`. `otfw serve` turns this on (SSR always has markup to adopt);
  `otfw build --ssg` turns it on too (pre-rendered pages have markup); a plain CSR
  `otfw build` mounts into an empty `#app`, so it keeps the leaner CSR bundle and stamps
  no sentinel. The compiler serve protocol's 4th header field is now a target **token**
  (`csr`/`ssg`/`hydrate`) instead of an SSG bool, so `otfwPlugin`/`compile` can request
  any backend over the long-lived `otfwc serve` connection.
- `otfw serve` — the per-request SSR server. Builds the client `dist/` (via
  `otfw build`), then builds the server render bundle once and serves it: asset requests
  come from `dist/`, every navigation is server-rendered per request through the same
  `renderRoute` the SSG pre-render uses (ARCHITECTURE.md §6, "SSR shares the SSG path").
  Returns the matched route's markup + `<head>` injected into the shell, with the correct
  HTTP status (200, or 404 when a path falls back to the registered 404 page). `--port`
  overrides the default (3000, scanning upward for a free port). The client adopts the
  server markup via the hydrate boot switch (above); a leaf route the hydrate backend
  can't yet emit an adopt factory for falls back to a clean CSR mount.
- The nav and last-updated generators now scan every top-level folder under `app/`, so
  additional doc sections (e.g. `/api`) need no config — any folder with a `DocsLayout`
  gets a generated sidebar and (with `lastUpdated`) the same last-updated/edit links as
  the main docs.
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

- Factored `serverEntrySource`, `buildServerBundle`, `injectMarkup`, and `injectHead`
  into `shared.js` so the SSG pre-render (`runPrerender`) and the new SSR server
  (`runServe`) build and render through a single shared path instead of duplicating the
  server bundle build.

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
