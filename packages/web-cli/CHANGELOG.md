# @opentf/web-cli

## [Unreleased]

## [1.13.1] - 2026-07-08

_Dependency updates._

## [1.13.0] - 2026-07-08

_Dependency updates._

## [1.12.0] - 2026-07-07

### Tests

- The serve e2e fixture middleware now exercises `@opentf/web/server`'s new cookie helpers
  through the real bundle path — `getCookie` gates `/guarded`, the root middleware
  `setCookie`s every response — with an assertion that the `Set-Cookie` header survives to
  the client.

## [1.11.0] - 2026-07-07

### Added

- **Server middleware governs every request under `otfw dev` and `otfw serve` — pages, API,
  loader data, and 404s (docs/MIDDLEWARE.md).** Both servers now wrap their pipeline (API
  dispatch → `__data.json` → SSR / app shell) in the `_middleware.*` chain, so
  `app/_middleware.js` can gate a page server-side, redirect, rewrite the request, add
  headers to any response, and stamp `context.locals` for API handlers and route loaders —
  the server-side counterpart to the client `routeGuard`. Static assets that exist on disk
  are served outside the pipeline (a root auth guard can't break the login page's CSS);
  dotted paths that aren't files (`/api/v1.0`) still flow through. `otfw build`'s
  `dist/server/api.js` now exports `apiRoutes` (routes only) and `middleware` (the pipeline
  runner) alongside the composed `apiHandler`, and is emitted for middleware-only apps too
  (previously skipped without `route.*` files). Middleware scope matching is i18n-aware
  (the config's locales are threaded into the bundle).

### Changed

- **API `_middleware.*` now runs before route matching** (pipeline level) under dev/serve:
  it also fires when no API route matches (e.g. gating a page under `/api`'s scope or a
  404), and its context no longer carries `params`/`query` — read those in the handler.
  A failed API/middleware build in dev now also 500s the governed middleware scopes instead
  of serving them unguarded until the next successful rebuild.

## [1.10.0] - 2026-07-07

### Fixed

- **Dev proxy: gzip double-decode.** When the proxied upstream sent a compressed response,
  `fetch` had already decompressed the body but the upstream's `Content-Encoding`/
  `Content-Length` headers were relayed verbatim, so the browser tried to decode the plain
  body a second time (`ERR_CONTENT_DECODING_FAILED`). The proxy now strips those headers
  from decompressed responses.

### Tests

- The missing-`site.url` build-gate test now resolves `cli.js` relative to the test file
  instead of the runner's cwd, so it passes from both the repo root and the package dir
  (the gate itself was always working).

## [1.9.0] - 2026-07-07

### Added

- **Dev proxy (`otfw.config` `proxy`).** `otfw dev` can forward configured path prefixes to
  a separately-running backend instead of handling them in-process — the provider-agnostic
  way to reach bindings the dev server can't host itself (e.g. Cloudflare **D1**, which only
  exists inside `wrangler dev`): `export default { proxy: { "/api": "http://localhost:8787" }
  }`. Matched prefixes (longest-first) are forwarded before the in-process API handler, so
  proxied endpoints never double-run; path/query/method/headers/body are preserved and an
  unreachable upstream returns a 502. Dev-only — no effect on `otfw build`. See the
  **Cloudflare Workers** deployment guide.

## [1.8.1] - 2026-07-07

### Tests

- New real-browser runtime orchestrator (`tests/e2e/runtime-browser.mjs`, in `test:e2e`):
  bundles the `web` runtime suite for the browser, loads it in headless Chromium, and
  marshals results back over CDP (46 tests). Skips cleanly without Chromium (`CHROME_BIN`).
- Real-browser hydrate e2e now covers the Portal-across-hydration upgrade-ordering path — a
  `<Portal>`-wrapped modal with a reactive `class` binding (the docs search-modal shape):
  asserts it adopts in place, relocates to `<body>` exactly once, and that clicking the
  trigger opens it (class binding live on first paint). A genuine regression guard.
- Browser e2e suites replaced fixed settle `sleep()`s with poll-until-condition waits, so
  each suite proceeds the moment the awaited end-state is reached and only times out (loudly)
  if it never happens — removing the CI-flake on slow runners.

## [1.8.0] - 2026-07-07

_Dependency updates._

## [1.7.0] - 2026-07-06

_Dependency updates._

## [1.6.0] - 2026-07-06

### Tests

- New real-browser e2e (`tests/e2e/lifecycle-hooks-browser.mjs`, in `test:e2e`) for the
  DOM lifecycle hooks: an SSR-hydrated `/hooks` fixture route (page hooks + a
  `<HookProbe>` component island) driven over CDP in headless Chromium — the
  synchronous initial `onMediaQuery` state, real ResizeObserver entries on a
  CSS-sized host, IntersectionObserver firing on real scroll, breakpoint flips via
  viewport emulation, full teardown on SPA navigation (zero callbacks afterwards),
  and fresh rewiring on return — with a clean console throughout.

## [1.5.0] - 2026-07-05

_Dependency updates._

## [1.4.0] - 2026-07-05

### Tests

- Real-browser hydration e2e (`tests/e2e/hydrate-browser.mjs`) now covers composed island
  shapes end-to-end: a recursive `<Tree>` sidebar (eager `<Link>` islands with `{children}`
  slots, conditional link/group branches, dynamic router-derived classes, and rich per-node
  object props across recursion), a conditional-root `<Pill>`, and a deliberately
  non-adoptable `<Panel>` (a JSX-const used in a conditional root → `RebuildIfServerChildren`)
  that wraps those islands. The last proves a mid-hydration rebuild builds its children
  cleanly instead of cascading `HydrationMismatch`es — the document-start MutationObserver
  now separates Panel's legitimate rebuild from the strict "nothing else was torn out"
  invariant for the rest of the page. 44 → 58 assertions.

## [1.3.1] - 2026-07-05

_Dependency updates._

## [1.3.0] - 2026-07-05

### Added

- **Route loaders** (docs/DATA.md): a `loader.{js,ts}` sibling to a `page.*` runs on the
  server and feeds the page's reactive `router.data`. `otfw dev` builds the loader bundle
  lazily and hot-reloads it on edits; `otfw serve` runs the matched loader per request
  before SSR and answers the `<path>/__data.json` endpoint; `otfw build` emits
  `dist/server/loaders.js`, and `--ssg` runs loaders at build time — inlining the
  `#__otfw_data` payload into each prerendered page and writing the per-locale sibling
  `__data.json` files SPA navigation fetches on a static host. `__data.json` is a reserved
  path: answered after API routes, before the asset branch, and a miss is a 404 (it never
  falls through to SSR). A loader `notFound()` serves the registered 404 page with HTTP
  404; a loader throw is a 500.
- **API routes** (SPEC §11): an endpoint is a `route.{js,ts}` file — the API analogue of a
  page's `page.{jsx,tsx}`, resolvable in any folder under `app/` (folder = URL). `otfw dev`
  serves them with hot reload, `otfw serve` mounts them ahead of SSR, and `otfw build` emits
  a self-contained `dist/server/api.js` for deploy adapters. A matched handler wins; a miss
  falls through to the page/SSR router so pages and endpoints coexist.
- The CLI help and docs now cover `otfw serve` (the per-request SSR server).

### Changed

- A folder may hold a `page.*` **or** a `route.*`, not both — `otfw dev`/`build` now error on
  a page/endpoint path conflict (matching Next.js's App Router). A `loader.*` without a
  sibling `page.*` (including one placed next to a `route.*`) is likewise a build error.
- `otfw serve` checks API endpoints before the static-asset branch (matching `otfw dev`), so
  an endpoint path with a dotted segment (`/api/v1.0`) resolves in both.

### Fixed

- **`otfw dev` hot reload of server bundles never actually reloaded.** The API (and now
  loader) bundles were re-imported with a `?v=N` cache-buster, but Bun's ESM cache ignores
  the query string on file URLs, so edits kept serving the first build. Rebuilds now emit a
  versioned *filename* (`api.<n>.js` / `loaders.<n>.js`), which genuinely re-evaluates.

- Route derivation clipped folders whose name starts with "app" (`app/appointments/` →
  `ointments`). The toolchain now passes the exact app directory to the API dispatcher and
  strips it verbatim for pages, endpoints, and middleware — any folder name works,
  including a nested `app/app/`.
- A failed API-bundle build in `otfw dev` no longer serves the SPA shell for endpoint URLs:
  discovered endpoints answer `500` with the build diagnostic until the next successful
  rebuild (an endpoint edit triggers it, as before).

## [1.2.0] - 2026-07-03

### Added

- Docs/blog builds now generate `/llms.txt` and `/llms-full.txt` from filesystem
  routes, honoring `public/llms.txt` and `public/llms-full.txt` overrides.
- Blog feed generation now writes Atom 1.0 (`<dir>/atom.xml`) alongside RSS 2.0.

### Changed

- Production docs/blog and SSG builds now require `site.url` or `--base-url` so
  canonical URLs, sitemap, feeds, and future LLM metadata are emitted with absolute
  URLs.

### Fixed

- Compiler resolution now checks `OTFWC_BIN`, then the packaged
  `@opentf/web-compiler` binary, then this repository's local `crates/otfw_cli`
  workspace. Public `@opentf/web-cli` installs no longer try to run Cargo just
  because the consuming app is inside a Cargo workspace.

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
