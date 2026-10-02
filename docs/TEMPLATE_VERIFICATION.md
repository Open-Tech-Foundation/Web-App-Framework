# Local plugin template feature audit

Checked sequentially on 2026-10-03: SPA, fullstack, docs, then library.
This replaces the earlier build-only report with feature checks using the current
checkout, including the component HMR changes in `a3ea98e`.

## Scope and setup

The existing generated JavaScript fixtures were refreshed with checkout copies of
`@opentf/esdev-plugin-web`, the compiler, runtime, and the relevant test/docs/SSG
packages. The native compiler was `target/debug/otfwc`, installed into each fixture's
compiler package. All five installations, including the library consumer, matched
the checkout's plugin, routes, compiler wrapper and index files byte for byte.
No registry compiler binary, workspace alias or `OTFWC_BIN` override was used.

These checks exercise template features through native esdev configurations in
isolated projects. They do **not** establish that untouched scaffolding commands
work. Installation was checked with `pnpm install --frozen-lockfile --ignore-scripts`;
package lifecycle scripts were intentionally excluded, followed by reapplying the
local package copies. Plugin `plugin.js` SHA-256:
`3faa7b7bb0dfa0e36dce0e69e6702d5578a8cd023497c7d1118d17a15443ab97`.

Two fixture-only adaptations allowed the framework checks to proceed:

- Production chunk references to `./entry.js` were normalized to the emitted hashed
  entry filename. This preserves one module identity; no duplicate entry was made.
- Fullstack probes following the direct-import failure supplied
  `globalThis.HTMLElement ??= class {}` before importing the server. The HTTP fixture
  also serialized rendering. Concurrent rendering was checked separately without
  that serialization, and failed as described below.

These adaptations are limitations of the end-to-end results. They are not changes
to this repository. The issue list below concerns code we can fix here.

Fixtures: `/tmp/otfw-local-template-audit/{spa,fullstack,docs,library,library-consumer}`.
Logs: `/tmp/otfw-local-feature-audit-20261003`. Each fixture's `local-packages.json`
records the checkout sources and physical package installation paths.

## 1. SPA

| Step | Result |
| --- | --- |
| Frozen dependency installation, then checkout package verification | Pass |
| Native component test | Pass: one counter test |
| `esdev build --minify` | Pass |
| `esdev start` and production `esdev preview` | Browser checks completed in both |
| Counter clicks and state updates | Pass in both |
| Added TSX dynamic route, params and query | Pass in both |
| Nested layout and child page | Pass in both |
| CSS module hashed class and computed color | Pass in both |
| Input binding, `$state`, `$derived`, `$ref` focus | Pass in both |
| `onMount` disposer on route navigation | Pass in both |
| MDX custom 404 under root layout | Fail in both |
| Removed page effect stops observing a shared signal | Pass in dev; fail in preview |

Browser checks: 15 passed, three failed. The two MDX failures are one underlying
issue. `esdev typecheck` was attempted but requires a TypeScript dependency absent
from this JavaScript starter. This is not evidence of a framework typecheck bug;
the TSX probe verifies compilation/rendering, not type checking.

Evidence: `spa-install.log`, `spa-test.log`, `spa-build.log`, `spa-browser.log`,
`spa-typecheck.log`, `spa-preview-normalization.json`.

## 2. Fullstack

| Step | Result |
| --- | --- |
| Frozen dependency installation and local package verification | Pass |
| DOM-free public runtime import | Fail: `HTMLElement is not defined` |
| Native server/browser release build | Pass |
| API GET and wrong-method rejection | Pass: 200 JSON and 405 |
| Middleware response header | Pass |
| Loader JSON endpoint and loader-backed SSR HTML | Pass |
| Real HTTP API, middleware, loader, SSR and missing-page response | Pass with bootstrap and serialized rendering |
| Native endpoint tests | Pass: two tests |
| Development and built-server browser rendering/hydration | Pass with adaptations above |
| Page/layout metadata through lazy virtual routes | Fail; eager namespace control passes |
| Dynamic `getStaticPaths` through lazy virtual routes | Fail; eager namespace control passes |
| Sequential SSR request isolation | Pass |
| Concurrent SSR request isolation | Fail: both responses contain request B's data |

The direct runtime probe made 11 assertions: eight passed, three failed. The
DOM-free import failure was tested in a separate process before those probes.

Evidence: `fullstack-install.log`, `fullstack-direct.log`, `fullstack-build.log`,
`fullstack-features.log`, `fullstack-http.log`, `fullstack-test.log`,
`fullstack-browser.log`.

## 3. Docs

| Step | Result |
| --- | --- |
| Frozen dependency installation and local package verification | Pass |
| Release build, prerender and output processing | Pass: six prerendered routes, four indexed pages |
| Sitemap, robots, LLM context and RSS/Atom artifacts | Generated |
| MDX page, sidebar/navigation and heading anchors | Pass in dev and preview |
| Highlighted code and mounted search UI | Pass in dev and preview |
| Search clean text and highlighted query | Pass in preview |
| Multiple matching sections on a single page | Pass: separate Signals and Lifecycle results |
| Search link opens matching section and closes dialog | Pass in preview |
| Dynamic prerendered page hydration | Pass in preview |
| Blog list and blog post | Pass in dev and preview |
| Dynamic docs navigation points to a concrete page | Fail in dev and preview: literal `[slug]` link |
| MDX custom 404 | Fail in dev and preview |
| Optional blog removed from config/content/navigation | Build passes; docs/search remain; blog HTML and RSS/Atom absent |

Browser checks: 14 passed, four failed, representing the two underlying issues.
Search returned `/docs/guide/#signals` and `/docs/guide/#lifecycle` for `Auditneedle`,
with clean highlighted excerpts. Multi-section search is already working.
Development search mounting was checked; built indexes were queried in preview.

Evidence: `docs-install.log`, `docs-build.log`, `docs-output.json`,
`docs-browser.log`, `docs-no-blog-build.log`, `docs-no-blog-results.json`.

## 4. Library and packed consumer

| Step | Result |
| --- | --- |
| Frozen dependency installation and local package verification | Pass for library and consumer |
| Initial props, click update and default props | Pass |
| Test cleanup, independent instances and explicit unmount/remount | Pass |
| Native DOM component tests | Four passed |
| `pnpm pack` | Pass: package exports entry and `src/Counter.jsx` included |
| Fresh packed contents in separate consumer | Pass |
| Consumer release build with local plugin | Pass |
| Consumer development and preview: own counter and imported library counter | Pass |
| Consumer navigation to another route | Pass in both |

No library-specific failure was found in these checks. The consumer used the newly
packed archive's contents in its installed library directory, alongside the local
framework packages. The test did not publish a package or test a registry install.

Evidence: `library-install.log`, `library-test.log`, `library-pack.log`,
`library-consumer-install.log`, `library-consumer-build.log`,
`library-consumer-browser.log`.

## Confirmed local fixes

Follow-up: Markdown/MDX 404 support is deferred. Plugin and SSG discovery now
reject these files with `Unsupported Markdown 404 route: <path>. Use 404.jsx or
404.tsx instead.` Runtime registration validates the whole map before changing any
routes, preventing homepage conflicts even for manually supplied maps. The MDX
failures above describe the audit baseline; they are now explicit unsupported-file
errors. Ordinary MDX pages and JSX/TSX custom 404s remain supported.

Second follow-up: concurrent SSR isolation is fixed. Each `renderRoute` owns its
route state and hydration collector through async context, including async metadata,
localized links, nested renders and failures. Six regression tests cover these
cases and cached module-level JSX. The original compiled fullstack A/B probe now
returns A/token-A and B/token-B correctly. A separate server probe passed 40
simultaneous HTTP requests without a render queue; the built fullstack server and
docs SSG build also passed with the local runtime. The audit rows below retain the
original observations; concurrent SSR is no longer pending.

| Priority | Issue and reproduction | Code to change |
| --- | --- | --- |
| P1 | Concurrent SSR mixes request data. Render `/concurrent/A` with `token-A` and `/concurrent/B` with `token-B` using `Promise.all`; both HTML responses contain B and `token-B`. Sequential rendering passes. | `packages/web/server/render.js` and request state in `packages/web/runtime/router.js` |
| P1 | Production route effects survive navigation. Open `/probe`, navigate away, then update the shared signal; the removed page's effect runs again. Its mount disposer already ran. Dev passes. | `packages/web/runtime/router.js`: reactive scope ownership in `buildRouteNode` and route cleanup |
| P2 | MDX custom 404 ignored. Add `app/404.mdx`, open a missing route; the ordinary default fallback appears instead. Confirmed in SPA and docs, dev and preview. | `packages/web/runtime/router.js`: `registerRoutes` recognizes only JSX/TSX fallback files |
| P2 | Lazy SSR metadata lost. Register `@otfw/routes`, render a page exporting `metadata`/`generateMetadata` under a layout with metadata; result is `{}`. Resolving the same namespaces eagerly restores metadata. | `packages/web/server/head.js` and namespace resolution in `packages/web/server/render.js` |
| P2 | Lazy dynamic static paths skipped. `collectRoutePaths()` skips a dynamic route exporting `getStaticPaths`; eager control produces A/B paths. | `packages/web/server/render.js`: `collectRoutePaths` |
| P2 | DOM-free server setup crashes. Import `registerRoutes` from `@opentf/web` without a DOM; importing `runtime/context.js` throws. The server entry does not currently expose route registration. | `packages/web/server/index.js` and public runtime import boundaries |
| P2 | Dynamic docs links contain placeholders. Prerender `/docs/topic/one`; sidebar and next-page navigation still link to `/docs/topic/[slug]`. | `packages/web-docs/build/docs-nav-plugin.js`: expand concrete paths or omit unresolved navigation entries |

The MDX homepage-conflict guard and concurrent SSR isolation are implemented; full
MDX fallback support is deferred. Next address production page effect cleanup.
Lazy metadata and static paths can share a
module-namespace resolution change with separate regression coverage.

## Coverage limits

This audit checked JavaScript starter shapes with targeted JSX, TSX, MDX, CSS-module,
lifecycle, routing, SSR, SSG, search, blog and source-library probes. It did not
regenerate and exhaustively check every TypeScript/styling/package-manager variant,
exercise registry publishing, or rerun the previous HMR suite. HMR evidence remains
in [HMR_VERIFICATION.md](HMR_VERIFICATION.md). Generated sitemap/feed/LLM files were
checked for presence and build success, not a complete content/schema audit.
Favicon 404s were incidental and are excluded from the framework issue list.
Temporary fixtures/logs may be removed by system cleanup; this report preserves
the observed results and reproductions.
