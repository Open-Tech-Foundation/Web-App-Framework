# @opentf/web-cli

## [Unreleased]

## [1.24.0] - 2026-07-30

### Tests

- **New browser e2e (`tests/e2e/template-parity.mjs`) — the verification pass CSR template cloning
  rests on.** `@opentf/web-compiler` now stamps static subtrees from a hoisted `<template>` instead
  of emitting a `createElement` per node, which is only a legal rewrite where the HTML parser
  leaves markup alone — and it often does not (`<p><div/></p>` re-parses as two siblings, a bare
  `<tr>` grows a `<tbody>`, non-table content inside a table is foster-parented out in front of
  it). Nothing in the existing suites would catch that: they assert what the compiler *emits*, not
  what a real engine builds from it.

  Each fixture is compiled twice — normally, and with `OTFWC_NO_TEMPLATES=1` — and both are built
  in headless Chromium and required to be indistinguishable, by `outerHTML` and node for node
  after `normalize()`. Fixtures cover docs prose, canonical tables, static/reactive interleaving,
  and a set of markup the compiler's analysis must refuse. It also asserts that stamping actually
  happened, so a silently disabled optimization can't pass by matching itself.

  Runs as the eighth suite in `test:e2e`; skips cleanly without Chromium, like its siblings.

## [1.23.1] - 2026-07-30

_Dependency updates._

## [1.23.0] - 2026-07-29

### Performance

- **Server-rendered HTML now hints its route chunks with `<link rel="modulepreload">`.** The
  pre-rendered `<head>` listed only the stylesheet and `bundle.js`, so the browser learned which
  page/layout chunks it needed only after `bundle.js` had downloaded *and run* — a four-step
  chain (HTML → bundle → page → layouts) where two steps suffice. `routeChunkManifest` maps each
  route to the chunks its first paint imports (page + layout chain + their static imports, minus
  anything the entry bundle already pulls in), and both SSG pre-render and `otfw serve` emit those
  links per route. The client build writes `dist/server/preload.json` so SSR can key off the
  pattern `renderRoute` now returns; a missing or malformed manifest just means no hints.

- **The client route map no longer ships absolute build paths.** `entrySource` used each route
  file's absolute path as its map key, so the entry bundle carried one copy of the build machine's
  checkout prefix per route — ~8KB of a 50KB bundle on the critical path for a large site, and a
  public disclosure of the CI directory layout. Keys are now app-relative (`/app/docs/page.jsx`);
  `registerRoutes` only ever read the `/app`-onward portion, so runtime behavior is unchanged. The
  `import()` specifier stays absolute for the bundler to resolve.

## [1.22.0] - 2026-07-25

_Dependency updates._

## [1.21.0] - 2026-07-25

_Dependency updates._

## [1.20.0] - 2026-07-25

### Tests

- The `hydrate-browser` e2e fixture's `<Framed>` slot moves back *after* its nested `<Tree>`.
  That ordering previously failed — `hydrateSlot` located a component's slotted content by the
  first `<!--c[-->` marker under the host, and the tree's `<Link>` islands emit markers of their
  own, so the parent adopted its children against a `<Link>`'s slot. The fixture had been
  ordered slot-first to dodge it; with that lookup fixed in `@opentf/web` (it now prefers the
  marker with no intervening component host), the original ordering is restored so the fixture
  regression-tests the fix instead of avoiding it.

## [1.19.0] - 2026-07-24

### Tests

- The `hydrate-browser` e2e fixture's `<Framed>` island now takes a light-DOM `{children}`
  slot *inside* its JSX-value local, plus a second `framed={false}` instance. `<Framed>` was
  documented as the exact `DocsLayout` shape, but it had no slot — the one ingredient that
  matters — so the suite stayed green while the docs site died on first paint with
  `ReferenceError: __children is not defined` (fixed in `@opentf/web-compiler`). Nine new
  assertions cover both branches: the slotted node is adopted in place, still parented by its
  slot, and present exactly once. Reverting the codegen fix now fails this suite with the
  reported error instead of passing.
- Its slot is ordered *before* the nested `<Tree>` deliberately: `hydrateSlot` locates slotted
  content by the first `<!--c[-->` marker under the host, and the tree's `<Link>` islands emit
  markers of their own — a separate, pre-existing limitation of that lookup.

## [1.18.0] - 2026-07-19

### Fixed

- **`otfw dev` now serves a worker/asset that lives in a symlinked dependency (its real
  path outside the project root) instead of 404'ing it.** The `/__worker/` and `/__asset/`
  dev handlers gated the decoded file path with a root-containment check
  (`resolve(file).startsWith(root)`), meant to stop a crafted `..` URL from reading
  arbitrary files. But a dependency reached through a symlinked `node_modules` (a
  workspace/isolated install, e.g. `@opentf/workeros-web`) resolves to a **real path
  outside `root`**, so its `new Worker(new URL("./w.js"))` / `new URL("./x.wasm")` was
  refused — every such worker/asset 404'd in dev even though `otfw build`/SSG emitted them
  fine. The handlers now serve only paths the dev worker/asset plugin **actually rewrote a
  reference to** (an allowlist populated during transform), which serves the symlinked-dep
  case correctly and is strictly tighter than the old check — a URL that was never emitted
  (a crafted or arbitrary path) is still refused.

## [1.17.0] - 2026-07-18

### Fixed

- **A worker referenced both as `new Worker(new URL(…))` and a bare `new URL(…)` is no
  longer downgraded to a copied asset (nested workers/assets 404).** `workerAssetsPlugin`
  deduped emitted files by path but keyed the *kind* off whichever reference was scanned
  first — so if a worker script was also referenced as a bare `new URL` (a prefetch/preload
  link) that was seen first, it was emitted as a verbatim `{ type: "asset" }` **copy**
  instead of a bundled chunk. That copy skips this plugin, so its own
  `new Worker(new URL("./program-worker.js"))` and `new URL("./assets/x.wasm")` stayed raw
  and 404'd at runtime (resolving to `/assets/program-worker.js`, `/assets/assets/x.wasm`).
  Emission kind is now decided by the target itself, not the reference: a worker — or any
  JS-ish script target (`.js`, `.mjs`, `.ts`, …) — is always bundled as a chunk (so its
  nested refs recurse) and dedupes to one output shared by every reference; only true
  binary assets (`.wasm`, images, fonts) are copied. Same decision in `otfw dev`.
- **Worker/asset references now resolve through Rolldown's resolver, and an
  unresolvable one warns instead of silently 404'ing.** `workerAssetsPlugin` resolved
  each `new URL(…, import.meta.url)` with a naive `dirname(importer) + spec` filesystem
  check and, on a miss, dropped the reference silently — so a worker/asset that isn't a
  literal on-disk sibling (symlinked `node_modules`, a package `exports` map, an
  extensionless specifier) was left dangling with no diagnostic. It now resolves via
  `this.resolve(…, { kind: "new-url" })` first (falling back to the sibling join), and
  emits a build **warning** naming the file and reference when it still can't be resolved
  — the same in `otfw dev`. Recursion into emitted worker chunks (nested workers, and
  assets referenced from inside a worker) was already working; this makes a genuine
  resolution failure visible rather than a silent runtime 404.

## [1.16.0] - 2026-07-18

### Fixed

- **Web workers and `new URL(…, import.meta.url)` assets are now emitted/served.** Both
  the `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })` convention
  and bare `new URL("./x.wasm", import.meta.url)` asset references were left by Rolldown as
  dangling runtime strings — the referenced worker/asset file was never produced, so it
  404'd at runtime (`import.meta.url` resolved the literal against the bundle's own URL).
  - `otfw build` (and `otfw build --ssg`, which bundles the same client) now runs a
    **worker/asset plugin** (mirroring Vite's `vite:worker` + `vite:asset`): a
    `new Worker(…)` target is emitted as its own hashed chunk — recursing into nested
    workers (a worker that spawns a worker) — and any other `new URL(…)` target (`.wasm`,
    images, …) as a hashed asset, with each reference rewritten to the emitted file via
    `import.meta.ROLLUP_FILE_URL_*`. Pre-rendered SSG pages reference the same emitted
    files in `/assets`, so they resolve on a plain static host.
  - `otfw dev` serves the same references on demand from `/__worker/*` (bundled
    self-contained, since a worker has no page import map) and `/__asset/*` (from disk,
    with the correct MIME — `.wasm` as `application/wasm`), guarded to the project root.

## [1.15.0] - 2026-07-18

### Added

- **`process.env.NODE_ENV` is now defined in both bundling paths**, gating the runtime's
  dev-only diagnostics (SPEC §5.4.4, e.g. the keyless-list reorder warning). `otfw dev`
  defines it as `"development"` so the diagnostics run; `otfw build` defines it as
  `"production"`, where minification then drops those branches — verified absent from the
  production bundle.

## [1.14.0] - 2026-07-08

### Added

- **Plain CSR builds now carry the root layout's metadata in `index.html`.** A CSR SPA
  (`otfw build`, no `--ssg`) serves one `index.html` shell for every route, and it
  previously ignored `export const metadata` entirely — so a favicon or description
  declared in the root `app/layout.jsx` never reached the document. The build now
  resolves the root layout chain's *route-independent* metadata (favicon/other `links`,
  site-wide `description`, Open Graph site defaults, `robots`, extra `meta`/`jsonLd`) and
  injects it into the shell. Per-**page** `title`, `canonical`, and `generateMetadata`
  remain route-specific and still require `--ssg` or `otfw serve`. Only the root layout is
  compiled for this (not the whole app), so CSR build cost is unaffected.

### Tests

- New `build-metadata` e2e drives the real CLI against the fixture and asserts head
  composition in both modes: plain CSR injects the root layout's route-independent
  metadata (favicon, feed alternate with `links[].type`, description, OG site default)
  with no per-route canonical/title; `--ssg` gives `/about` its page title, a per-route
  canonical, and the inherited feed alternate.

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
