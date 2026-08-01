# @opentf/web

## [Unreleased]

### Fixed

- **`<ContextProvider>` now works on server-rendered pages** (`server/builtins.js`,
  `server/ssg-runtime.js`). `readContext` resolves a consumer's provider with
  `closest('[data-otfw-ctx~=…]')`, but the SSG renderer emitted the provider as a bare
  passthrough that dropped every prop — so the marker attribute was absent from the served
  HTML. Consumers are Custom Elements that upgrade the moment their definition is
  registered, which happens *before* the enclosing component's hydrate code assigns the
  provider's `context` prop; finding no provider, every consumer on the page silently bound
  to the context **default** and never saw a provided value again. Context therefore worked
  under client rendering and was inert after hydration — values never propagated and nested
  providers never overrode. SSG renderers may now declare a `hostAttrs(props)` hook for
  attributes that must be in the markup before any script runs, and the provider uses it to
  emit `data-otfw-ctx`.

## [0.27.0] - 2026-07-31

### Fixed

- **A JSX value held in data no longer renders as `[object Object]`** (`runtime/dom.js`). A JSX
  value the server cannot hand over as a DOM node — a component prop holding an element
  (`<Tabs tabs={[{ label, content: <CodeBlock/> }]} />`, the MDX idiom) or JSX embedded in a
  list's data — is rendered to HTML and crosses to the client in the hydration payload as an
  `{ __html }` marker. `ssgText` splices it raw on the server; the client had no counterpart, so
  it fell through to `String(value)` and the page showed a literal `[object Object]` where every
  tab panel should have been. The island cannot repair itself either: a prop read into a local is
  a snapshot (SPEC §1), so the parent's later `setProp` with the real nodes changes nothing.

  `toNodes`/`bindText` now parse the marker back into the nodes the server rendered, and skip the
  work when an unchanged marker re-runs — it is immutable, and re-parsing would tear down and
  re-upgrade the islands inside it.

- **Islands inside such markup keep their props** (`server/ssg-runtime.js`, `runtime/hydrate.js`).
  JSX in module-level data is rendered when the module is imported — before any
  `beginHydrationCollect` bracket — so there is no payload entry to key by `data-h`, and the
  re-parsed copy upgraded with no props at all and blanked its own content. Those hosts now carry
  their JSON-safe props inline as `data-hp`, which `hydrationProps` falls back to, so the markup
  hydrates correctly wherever it is spliced in.

- **Raw-text elements are served as raw text** (`server/ssg-runtime.js`, `runtime/hydrate.js`).
  `<textarea>`, `<title>`, `<style>` and `<script>` are RCDATA/raw text: the tokenizer does not
  parse markup in them, so the `<!--$-->…<!--/-->` hole markers were served as those literal
  characters — visible in the textarea, in the tab title and in the stylesheet, to a crawler and
  to a no-JS visitor. New `ssgRawText` writes a `<script>`/`<style>` hole verbatim (an escape
  would show through: `a &gt; b` is the entity, not `>`) with the element's own closing tag
  broken up so a value cannot end it early, and new `claimRawText` binds the element's single
  text node on hydration instead of hunting for markers that cannot exist there.

## [0.26.0] - 2026-07-30

### Added

- **`template(html)`** (`runtime/dom.js`) — compiles a static subtree into a `<template>` once and
  returns a function that stamps `cloneNode(true)` copies of it. CSR codegen emits one hoisted
  `const` per distinct static subtree in a module and calls it where it used to emit a
  `createElement` per node; see `@opentf/web-compiler`'s changelog for what that is worth on a
  large page. The parse is deferred to the first call so importing a compiled module never
  touches `document`.

  Not a general-purpose `innerHTML`: the compiler only routes markup here after proving the HTML
  parser rebuilds it exactly as `createElement` would, and handing it author markup would
  reintroduce every reparenting rule that analysis exists to avoid.

## [0.25.0] - 2026-07-29

### Performance

- **A route's page and layout chunks now download in parallel** (`runtime/router.js`).
  `buildRouteNode` and `hydrateRouteNode` awaited each `import()` in turn — the page chunk, then
  layout 1, then layout 2 — so a page under two layouts paid three stacked round trips (~1.1s at
  ~350–400ms per chunk) where one would do. Nothing required the serialization: `layoutChain`
  knows the whole set before the first import starts. Both now resolve every entry in a single
  `resolveAll` batch, which affects first paint *and* every SPA navigation on every app.

  `resolveAll` settles all imports before rethrowing the earliest failure, rather than using
  `Promise.all`. After a redeploy *every* stale chunk 404s, and `Promise.all` would reject on the
  first while leaving the others' rejections unhandled; the stale-chunk reload recovery still sees
  the same `isChunkLoadError` it did before.

### Changed

- `renderRoute` additionally returns `route` (the matched pattern, `null` for the 404 fallback)
  and `collectRoutePaths` entries carry `route` alongside `path`/`params` — so the toolchain can
  key build-time, per-route data (the chunk manifest behind `<link rel="modulepreload">`) by
  pattern. Purely additive.

## [0.24.0] - 2026-07-25

### Fixed

- **A route-guard redirect on first paint no longer leaves the hydration flag set**
  (`runtime/router.js`). The flag is seeded `true` from the server sentinel at module load, and
  `navigate` clears it in the `finally` of its `hydrate && match` block — but a guard that
  redirects returns *before* that block, so the flag stayed `true` for the rest of the session.
  Every island created by the redirected build then saw `isHydrating() && this.firstChild` and
  took the **adopt** arm against DOM its own parent had just `createElement`'d, mismatching
  (`HydrationMismatch: expected a region start marker, found <div>`) and rebuilding — and so did
  every SPA navigation after it. This is what broke the live `js-std.opentechf.org`, whose
  guard redirects `/` → `/docs`: a single reported mismatch and a full rebuild of the shell,
  navbar and 330-node sidebar on entry. The guard's `redirect`/`replace` now leave hydration
  before the target route builds (that route's server DOM belongs to the route being left, so
  building fresh is correct).
- **`hydrateSlot` tolerates an unlabeled slot marker.** Slot markers now carry the owning host's
  tag, but `@opentf/web-cli` pins `@opentf/web-compiler`, so this runtime can run against server
  HTML produced by a compiler one release behind that still emits bare `<!--c[-->`. A strict
  label comparison made the lookup match nothing — a silent no-op leaving every slot's
  reactivity dead on first paint with nothing logged. An unlabeled marker now falls back to the
  positional heuristic, so version skew degrades to the old behavior instead of a worse one.

## [0.23.0] - 2026-07-25

### Fixed

- **`<CodeFence>` / `<RawHtml>` no longer destroy their server-rendered DOM on hydration**
  (`runtime/code-block.js`, `runtime/raw-html.js`). Both are hand-written elements that assign
  `innerHTML` on connect — with no hydration awareness — and the adopt walk re-applies the
  `html` prop right after claiming the host (the MDX front-end writes `html={"…"}` as an
  expression, so it's a dynamic prop). Every code block on every page was therefore torn out
  and re-parsed on first paint: on the docs site that was **9,072 rebuilt nodes** and 264
  discarded server blocks, the single biggest source of first-paint churn. They now adopt the
  markup they were rendered with (wiring only the copy button) and re-render only when the
  value actually changes.
- **Slot markers are matched by label, and closes by depth** (`runtime/hydrate.js`). Slot
  regions nest whenever a component forwards `{children}` into another, and the old lookups
  couldn't cope: `skipSlot` scanned siblings for the *first* `<!--c]-->` and stopped inside a
  nested region (`expected <span>, found comment <!--c]-->` — `<Tooltip>`), while
  `hydrateSlot` guessed the host's slot by tree order and adopted against another component's
  region (`expected a children-slot marker, found <span>` — `<Card>`, whose children were then
  lost). The markers now carry the owning host's tag (see `otfw_compiler`), so `skipSlot`
  depth-matches its own close and `hydrateSlot` finds the marker labeled with `host.tagName`.
- **`hydrateChild` subscribes without building** (`runtime/dom.js`). Its first effect run used
  to evaluate the real build closure just to register dependencies, discarding the result — but
  a branch that re-slots `{children}` `appendChild`s those *live* server nodes into the
  throwaway tree, emptying the slot. It now takes an optional fourth argument, the same
  expression with null branches, and runs that instead.
- **New `slotChildren(host)`** — the nodes in a host's own `{children}` slot in the server DOM.
  A component that can't adopt (unsupported view shape, or a mismatch it's recovering from)
  rebuilds via CSR, and its build used to capture an already-cleared host: the page content the
  parent had slotted in was destroyed, not just rebuilt. Codegen now rescues it through this
  helper first.

## [0.22.0] - 2026-07-25

### Fixed

- **`hydrateSlot` no longer adopts a component's children against a *nested* component's slot.**
  It located the slot by the first `<!--c[-->` marker under the host, but a component renders
  chrome around its slot and any nested component in that chrome emits slot markers of its own —
  which come first in tree order. `<DocsLayout>` with the default `frame` is the case that broke:
  `<Navbar>` (with its own slotted `<Link>`s) sits before the prose slot, so the parent adopted
  its children against the navbar's region and threw
  `HydrationMismatch: expected <h1>, found comment <!--[-->`, tearing out and rebuilding the whole
  layout on first paint. The lookup now prefers the first marker with no intervening component
  host — unambiguously the host's own slot — and only falls back to first-in-tree-order when
  there is none, so the forwarding shape (`<Card>{children}</Card>` as the entire view) keeps
  working.

## [0.21.0] - 2026-07-24

### Fixed

- **`skipSlot` now returns the slotted nodes it steps over.** Adoption never *captures* a
  component's light-DOM children the way a CSR build does — they are already server-rendered in
  place — but a JSX-value local's `build` fallback still closes over the children local, so the
  compiler had no live binding to give it and the docs layout died on first paint with
  `ReferenceError: __children is not defined`. `skipSlot` still steps the cursor past the
  `<!--c[-->…<!--c]-->` region exactly as before; it just hands back the nodes in between so the
  hydrate backend can seed that binding. Purely additive — existing call sites ignore the return.
  Pairs with `@opentf/web-compiler` ≥ 0.11.0.

## [0.20.0] - 2026-07-18

### Tests

- **Isolated the SSG `server/render.test.js` suite from shared-route pollution.** It reset the
  shared route-table singleton only in `afterEach`, so its first test inherited whatever a
  sibling suite (e.g. `router.test.js`, which registers a root layout and never cleans up) left
  behind — a leftover layout wrapped the rendered HTML and the exact-equality assertion failed,
  flaky under CI's bun test-file ordering but green locally. Now resets the routes in
  `beforeEach` too, so the suite is isolated regardless of order.

## [0.19.0] - 2026-07-18

### Fixed

- **The docs-layout `const body = <jsx>` idiom now hydrates without a flash (Phase 2.1e).** A
  layout/component that binds JSX to a local and renders it at a `{body}` hole (or a bare
  dynamic-node branch) — the shape at the heart of `DocsLayout` — was not adoptable: on first
  navigation to a docs page the content area rebuilt from scratch, blanking and flashing, and
  the rebuild cascaded `HydrationMismatch`es through every nested island (nav, sidebar). The
  hydrate compiler now emits such a local as a dual `{ build, adopt }` object and adopts its
  server subtree in place. Adds a `hydrateHole` runtime helper (adopts a JSX-value hole between
  its `<!--$-->…<!--/-->` markers instead of stripping and rebuilding it).

## [0.18.0] - 2026-07-08

### Fixed

- **`metadata.links[].type` is now emitted in `<head>`.** A feed/alternate link such as
  `{ rel: "alternate", type: "application/rss+xml", href: "/blog/rss.xml" }` previously
  rendered without its `type` attribute, so crawlers couldn't tell the MIME type of the
  linked resource. `renderHead` now emits `type` alongside `rel`/`href`/`hreflang`.

### Added

- **Route-independent head rendering (`renderHead(meta, { path: null })`).** Renders
  site-wide metadata without stamping a route-specific `canonical` / `og:url` — a shared
  document (e.g. a CSR SPA shell served for every route) no longer claims one route's URL
  as canonical for all of them. An explicit `meta.canonical` is still honored. Backs the
  new plain-CSR layout-metadata injection in `@opentf/web-cli`.

## [0.17.0] - 2026-07-08

### Fixed

- **Stale route chunks after a redeploy no longer dead-end the page.** A tab still
  running the previous deploy's `index.html` holds the old content-hashed chunk names;
  the moment it navigates to a not-yet-loaded route, that chunk's lazy `import()` 404s
  (`Failed to fetch dynamically imported module`) and the router used to paint a
  `Failed to load` overlay. The client router now recovers with a single full page load,
  which fetches the fresh `index.html` (new hashes) and completes the navigation. The
  reload is guarded by a one-time, tab-scoped `sessionStorage` flag that survives the
  reload and clears on the next successful render, so a genuinely broken deploy reloads
  once and then surfaces the error instead of looping.

## [0.16.0] - 2026-07-07

### Added

- **Cookie helpers (`@opentf/web/server`)** — standards-based `Cookie` / `Set-Cookie`
  wrappers for middleware, API handlers, and loaders, closing the ergonomics gap with
  Next.js's `request.cookies`: `getCookie(source, name)` / `getCookies(source)` read from a
  `Request`, `Headers`, or raw header string (percent-decoded; first duplicate wins per
  RFC 6265); `setCookie(target, name, value, options)` appends a `Set-Cookie` to a
  `Response`/`Headers` (appends, never overwrites — session + CSRF coexist);
  `deleteCookie(target, name, { path, domain })` expires with `Max-Age=0`;
  `serializeCookie` builds the raw header value. Values round-trip through percent-encoding;
  `path` defaults to `"/"` (pass `path: null` to omit); invalid names/`maxAge`/`expires`/
  `sameSite` throw, and `sameSite: "None"` without `secure: true` fails at write time
  (browsers silently drop it otherwise). Fully typed (`CookieOptions`, `CookieSource`,
  `CookieTarget`). See docs/MIDDLEWARE.md §3.

## [0.15.0] - 2026-07-07

### Added

- **Request middleware for the whole pipeline (`createMiddleware`) — pages, API, and loader
  data alike, like Next.js middleware.** `_middleware.{js,ts}` files are no longer an
  API-only construct: the new `createMiddleware(middlewareModules, { appDir, i18n })` builds
  a scope-matched runner (`{ size, scopes, run(request, terminal, { env, ctx }) }`) the
  servers wrap around their entire request pipeline, so `app/_middleware.js` gates SSR pages,
  API endpoints, `__data.json` loader requests, and 404s equally. Middleware runs **before
  routing**: it can short-circuit (return/throw a `Response`), rewrite the request
  (`next(new Request(...))` re-routes downstream), decorate any outgoing response (wrap
  `next()`), and stamp `context.locals`. Scope matching is security-aware — a page's
  `__data.json` is governed by the page's scope (no loader-data leak around a guard) and a
  non-default locale prefix is stripped (`/fr/admin` is governed by `/admin` middleware).
  A forgotten `return next()` is a 500, not a hang. See the new **docs/MIDDLEWARE.md**.
- **`locals` flows into route loaders.** `createLoaderRegistry`'s `load`/`loadSerialized`
  accept `locals` and `handle` (the `__data.json` endpoint) takes `{ locals }`, so a loader
  reads what middleware stamped (`loader({ locals })`) — the `locals: {}` placeholder is now
  live. Empty at SSG prerender, where no middleware runs.
- **`createApiHandler` accepts a pipeline `locals` bag.** The handler is now
  `(request, env, ctx, init?)`; `init.locals` is shared by reference with handler contexts,
  so pipeline middleware and API handlers see the same bag. API-internal middleware chains
  also support `next(rewrittenRequest)`.
- **`createFetchHandler({ middleware })`.** The adapter wrapper can wrap the whole request —
  handler *and* fallback — in the middleware runner, so a Workers entry guards
  `env.ASSETS`-served pages too: `createFetchHandler(apiRoutes, { middleware, fallback })`.
  Pair it with the routes-only `apiRoutes` bundle export (the composed `apiHandler` would run
  API-scoped middleware twice). Types for all of the above (`MiddlewareContext`, `NextFn`
  with rewrite, `MiddlewareRunner`, `RequestHandler` `init`) added to `api.d.ts`.

### Changed

- `middlewareScopeFromPath` moved to `server/middleware.js` (still re-exported from
  `@opentf/web/server` and `server/api.js` — no import changes needed).

## [0.14.0] - 2026-07-07

### Added

- **API handlers receive the runtime's `env`/`ctx` (platform bindings) on the context.**
  `createApiHandler`'s handler is now `(request, env, ctx)` and threads them onto the
  per-request context, so on Cloudflare Workers a handler reaches its bindings via
  `context.env` (`env.DB` for D1, KV, secrets) and `context.ctx.waitUntil(...)` for
  post-response work; Bun/Node leave them `undefined` (use `process.env`). `createFetchHandler`
  forwards `env`/`ctx` to both the handler and the `fallback`, so a Worker entry can serve
  static assets from `env.ASSETS`: `createFetchHandler(apiHandler, { fallback: (req, env) =>
  env.ASSETS.fetch(req) })`. Types (`ApiContext.env`/`ctx`, `FetchHandlerOptions.fallback`)
  updated. See the new **Cloudflare Workers** deployment guide.

### Fixed

- **An array-valued dynamic hole renders each item instead of `[object Object]`.** A hole
  holding an array of JSX (`{[<a/>, <b/>]}`) or primitives (`{[1, 2, 3]}`) served through
  `ssgText` fell through to `String(v)` — emitting `[object Object],[object Object]` (or a
  comma-joined string) into the SSG/pre-rendered HTML, so first paint and no-JS/SEO output
  were wrong until the client rebuilt. `ssgText` now flattens arrays and concatenates each
  item with no separator, mirroring CSR's `toNodes`/`bindText` so the server HTML matches the
  hydrated render. (Workaround was to hoist the array to a `const`.)

### Tests

- Runtime tests that probe engine-fidelity paths (custom-element upgrade timing, the real
  microtask/event loop, portal relocation, event delegation) moved from happy-dom to real
  headless Chromium — `runtime/{dom,events,hydrate,context,portal,error-boundary}.test.js`
  are now `*.browser.js` (out of the `bun test` glob), run by the `web-cli` browser e2e
  orchestrator. happy-dom stays for fast logic + adequate-fidelity DOM units.
- New table-driven hydration construct matrix (`runtime/hydrate.e2e.test.js`) drives one
  source per JSX construct through the real compiler for both the ssg and hydrate targets
  and asserts the three first-paint invariants (expected marker shape, no adopt-walk rebuild,
  reactive change runs live on the adopted nodes). Adding a row is how a future hydration bug
  should be reproduced then fixed.

## [0.13.0] - 2026-07-07

### Fixed

- **`<Portal>` (and other passthrough built-ins) hydrate their content on first paint.**
  Reactive content wrapped in `<Portal>` — e.g. the docs navbar search modal — was dead until
  a later CSR rebuild (it only "woke up" after an SPA navigation). Two coupled causes: the
  hand-written SSG renderers for `web-internal-portal`/`-context-provider`/`-error-boundary`
  omitted the `<!--c[-->…<!--c]-->` slot markers the compiled `hydrateSlot` walk needs to
  locate the children, and the Portal relocated its children to `<body>` on connect *before*
  the owning component's adopt walk ran — tearing the slot out from under `hydrateSlot`, so
  the portaled bindings were never wired. The built-ins now emit the slot markers, and the
  Portal defers its move until hydration finishes (new `afterHydration`/`endHydration` flush)
  so the parent adopts the server nodes in place first, then relocates the now-live nodes.

## [0.12.0] - 2026-07-06

### Fixed

- **Hydration no longer duplicates a node-valued text hole.** A `{expr}` hole whose value
  is a JSX node (or array of them) stored in data — e.g. a code example rendered
  `{EXAMPLES.find(...).body}` — is server-rendered as inline markup inside the hole, but the
  client's `bindText` node arm *rebuilds* it rather than adopting. `claimText` used to leave
  that server node in the hole, so the rebuilt copy landed beside it and the content rendered
  twice. `claimText` now strips any non-text server content from the hole, keeping the single
  adopt-able text anchor, so exactly one copy survives.

## [0.11.0] - 2026-07-06

### Added

- SSR-safe no-op stubs for the new DOM lifecycle hooks — `onResize`, `onMediaQuery`,
  `onVisibilityChange` — alongside `onMount`/`onCleanup` in `runtime/lifecycle.js`, so
  source-level imports resolve and stray calls (SSR, outside a compiled component) are
  harmless. The real behavior is compiler-emitted (see `@opentf/web-compiler`).
- Real-browser end-to-end coverage for the DOM hooks lives in
  `@opentf/web-cli`'s e2e suite (`tests/e2e/lifecycle-hooks-browser.mjs`) — actual
  ResizeObserver/IntersectionObserver/matchMedia driven by real viewport, scroll,
  and SPA-navigation changes against an SSR-hydrated page.

## [0.10.0] - 2026-07-05

### Fixed

- **Route guard `to` object** now exposes `pathname` (the documented, platform-standard
  field, matching `router.pathname`) and `fullPath` (pathname + query + hash). `path` is kept
  as a back-compat alias. Guards can inspect the query/hash and build redirect-then-return
  flows (`redirect("/login?next=" + encodeURIComponent(to.fullPath))`).

## [0.9.0] - 2026-07-05

### Added

- `runBuild(fn)` — runs `fn` with the hydration flag (`isHydrating()`) cleared, restoring
  the prior value after (nesting-safe, synchronous). Codegen brackets every build path that
  can run mid-hydration with it, so a component that builds fresh DOM during first paint
  forces its child islands to build too, rather than adopt a subtree that was never
  server-rendered. See the `@opentf/web-compiler` note below and docs/HYDRATION.md §3.5.

### Fixed

- **Hydration: a build during first paint no longer cascades mismatches into child islands.**
  When a non-adoptable component (or a mismatch-recovery `__build`) built fresh DOM while
  `isHydrating()` was still set, each child Custom Element it created upgraded synchronously
  and took the *adopt* arm — claiming server markers in DOM that was just built, not
  server-rendered — mismatching and rebuilding, whose children then did the same. One
  non-adoptable layout could error-spam and flash a whole page's nested islands (nav, sidebar,
  every `<Link>`). The generated build paths now run inside `runBuild` (above), which clears
  the flag so the fresh subtree builds cleanly. The adopt path and true first-paint adoption
  are unchanged.
- **Hydration: eagerly-defined components no longer double-build the server DOM.** The
  build-vs-adopt flag (`isHydrating()`) was only set inside `mountApp` (`beginHydration`),
  but a custom element upgrades — and runs its build/adopt switch — the moment its class is
  `customElements.define`d. Framework components imported eagerly by the app entry (notably
  `<Link>`) are defined during the entry bundle's evaluation, *before* `mountApp` runs, so
  every server-rendered `<web-link>` took the build arm — capturing the server subtree as
  `children` and re-wrapping it (`<a><a>`), silently, on every page. The flag now initializes
  synchronously at module load from the server sentinel (`[data-otfw-hydrate]`), before any
  component defines; `mountApp` clears it when a mount isn't hydrating. First paint adopts;
  CSR mounts and SPA navigations build fresh.
- **Hydration: a parent adopt walk no longer clobbers a child island's rich props.** In a
  list/tree of components (e.g. a recursive sidebar), a parent's `connectedCallback` runs
  before its later-in-DOM children upgrade, so `setProp(childHost, "item", obj)` found the
  child still inert (`"item" in el` false) and fell back to `setAttr` — stringifying the
  object to `"[object Object]"` and, via `attributeChangedCallback`, overwriting the child's
  correct payload-hydrated signal. That flipped conditional branches (`item.path` became
  undefined) and threw `HydrationMismatch`. `setProp` now forces the pending upgrade so a
  component prop always lands as a property (rich value), never a stringified attribute.

## [0.8.0] - 2026-07-05

### Added

- **Route loaders — client half** (docs/DATA.md): the reactive `router.data` exposes a
  route's server-loader result to pages (like `router.params`); `mountApp({ loaders })` /
  `registerLoaderRoutes` register which route patterns have one. `navigate` resolves the
  data *before* committing (the inline `#__otfw_data` payload on first paint, a
  `<path>/__data.json` fetch on SPA navigation), discards a superseded navigation's late
  data via a sequence token, and reports a failed fetch (`phase: "data"`) while still
  committing with `router.data` undefined. `renderRoute` accepts a `{ data }` option
  (back-compatible) so the server render exposes the same value.
- **Route loaders — server half** (`@opentf/web/server`, docs/DATA.md):
  `createLoaderRegistry` turns discovered `loader.{js,ts}` modules into a matcher/runner
  (`[param]`/`[...rest]` + i18n locale-prefix stripping — the API handler's conventions)
  and the `<path>/__data.json` HTTP endpoint (`handle`); `notFound()`/`isNotFound`
  (property-marked, safe across bundle boundaries) give loaders 404 semantics;
  `serializeRouteData` escapes payloads for inline embedding. Typed in `server/index.d.ts`
  (`Loader`, `LoaderContext`, `LoaderRegistry`, …).
- **`resource()`** — the client-side async-data primitive (SPEC §7.4): wraps a fetcher in
  signals as reactive `{ data, loading, error, refetch }`; an optional reactive source
  re-fetches on change (`null`/`false` pauses); each run aborts the previous one
  (`AbortController` handed to the fetcher as `{ signal }`) and out-of-order resolutions
  are discarded; a rejection keeps the last good `data`. On the server nothing fetches and
  `loading` stays `true`, so SSG renders the loading branch and hydration stays aligned.
- **API routes runtime** (`@opentf/web/server`): `createApiHandler` dispatches file-based
  `Request → Response` endpoints — method-named handlers (`GET`/`POST`/…), `[param]` /
  `[...rest]` matching (shared with the page router), auto `HEAD`/`OPTIONS`, `405` + `Allow`,
  and nested `_middleware` composed outermost-first with a shared `context.locals`. Returns
  `null` on no-match so the caller can fall through to SSR. `createFetchHandler` wraps it
  into a total Fetch handler for Fetch-native runtimes (Bun/Cloudflare Workers/Deno), and
  `@opentf/web/server/adapters/node` (`toNodeListener`) bridges `node:http` — including
  multi-cookie responses (each `Set-Cookie` is written as its own header line). Params
  arrive percent-decoded, a root `app/_middleware.*` governs every endpoint, auto-`HEAD`
  mirrors the headers of a plain-value `GET`, and `createApiHandler` takes an `appDir`
  option (the CLI passes it) so route derivation is exact for any folder name. Ships
  TypeScript definitions for the server surface (`ApiHandler`, `Middleware`, `ApiContext`,
  `RouteParams`, …).
- **Reactive ownership scopes** (`scope()` in the signals core, exported from the package
  root): collects the disposers of every effect created while a build function runs, so a
  dynamic region can tear its bindings down as a unit. Effects created during a flush-time
  re-run never attach to an ambient scope — ownership is always explicit.

### Fixed

- **Route derivation clipped folders whose name starts with "app".** The page router
  stripped the app-dir prefix with a greedy `/app` match, so a route folder like
  `app/appointments/` derived to a broken path (`ointments`) and never matched. The
  prefix is now pinned to a complete `/app` path segment.
- **Literal regex characters in route folders were treated as patterns.** A `v1.0`
  folder matched `/v1X0` too; literal parts of a route are now regex-escaped in both
  the page router and the API dispatcher.
- **Evicted keyed-list items leaked their binding effects.** `bindList`/`hydrateList`
  removed a stale row's DOM node but left its `bindText`/`bindAttr` effects subscribed, so
  any signal shared across rows (e.g. a selection signal every row's `class` reads)
  accumulated one zombie effect per discarded row and re-ran them all on every later write.
  In the js-framework-benchmark suite this made *select row* cost more than *create 1,000
  rows* (~85 ms vs ~65 ms unthrottled). Items now build inside a `scope` and are disposed on
  eviction; the list's own disposer also tears down all live items.
- **Swapped conditional branches leaked their binding effects** the same way: `bindChild`/
  `hydrateChild` regions now own each branch's effects and dispose them when the branch is
  replaced (including the discarded subscribe-only first build during hydration).
- **Unmounted pages leaked their binding effects**: `mount()` now builds a factory view
  inside a `scope` and registers its disposer as a lifecycle cleanup, so the router's
  navigation teardown stops every effect the outgoing page created.

## [0.7.0] - 2026-07-03

### Added

- **Component `{children}`-slot hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1d): a
  component used *with* children (`<Card><button onclick=…/></Card>`) now hydrates instead of
  falling back to a rebuild — the last structural region. SSG brackets a component's light-DOM
  slot with **distinct** `<!--c[-->…<!--c]-->` markers; the component's adopt walk steps over
  its slot with the new `skipSlot`, while the **composing parent** owns the slotted content's
  reactivity (it's the parent's JSX) and adopts it via the new `hydrateSlot`, which locates the
  slot by scanning the host for its marker. This is order-independent of when the component
  upgrades, because adoption only wires (never moves) nodes — so a parent page and a
  self-upgrading child island can co-adopt the same host's interleaved content. New runtime
  API: `skipSlot`, `hydrateSlot`, `SLOT_START`/`SLOT_END`.
- **Layout-chain / `{children}`-slot hydration** (`docs/HYDRATION.md` §3.2/§3.4 / phasing
  2.1c): a layout-wrapped route now *adopts* its whole server DOM instead of falling back to
  a CSR rebuild — the last structural region. A page/layout now emits `hydrateAt(cursor,
  props)` (the adopt walk over an existing cursor) plus a `hydrate(root, props)` wrapper
  (`= hydrateAt(cursor(root), props)`); SSG brackets a page/layout `{children}` slot with
  `<!--[-->…<!--]-->`; and the router's new `hydrateRouteNode` threads **one cursor** through
  the entire layout chain — each layout claims its own structure and, at its `{children}`
  slot, hands its cursor to the nested route's adopt thunk (`props.children(cur)`), which
  claims the inner subtree and advances the cursor, down to the page. A route whose page or
  any layout isn't adoptable falls back to a clean CSR build; a mismatch anywhere disposes
  each layer's partial wiring on the way up. New runtime API: `hydrateRouteNode`.
- **Conditional / dynamic-node hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1b): a
  server-rendered `{cond ? <A/> : <B/>}` (or `{cond && <X/>}`) region now *adopts* the
  rendered branch instead of rebuilding. SSG brackets the branch with `<!--[-->…<!--]-->`
  (a falsy `&&` renders an empty region, like an empty list); the Hydrate codegen emits an
  adopt fn and a CSR build fn per branch, and the new `hydrateChild` runtime helper runs the
  adopt closure to claim the rendered branch off the shared cursor, then swaps to a
  freshly-built branch (via the build closure) when a later reactive change selects a
  different one — the closing `<!--]-->` is the swap anchor. `bindChild` is refactored to
  share the swap effect (`childEffect`) with `hydrateChild`. New runtime API: `hydrateChild`.
  The list/conditional region markers and their claim helpers are renamed to the neutral
  `REGION_START`/`REGION_END` and `claimRegionStart`/`claimRegionEnd` (shared by both).
- **Keyed-list hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1a): a server-rendered
  `{items.map(...)}` region now *adopts* instead of rebuilding. SSG brackets the region
  with `<!--[-->…<!--]-->` markers; the Hydrate codegen emits an adopt-item walk (claiming
  each item's root node off the shared cursor) plus a CSR build-item function, and the new
  `hydrateList` runtime helper seeds the keyed reconcile from the adopted `{signal, node}`
  pairs — so the first paint claims the server `<li>`s with no flash, and a later data
  change builds/moves/removes items from that adopted state (kept items keep their identity).
  The closing `<!--]-->` becomes the reconcile anchor. `bindList` is refactored to share the
  reconcile effect (`reconcileList`) with `hydrateList`. New runtime API: `hydrateList` and
  the shared region-marker helpers `claimRegionStart`/`claimRegionEnd`,
  `REGION_START`/`REGION_END`. A list-containing page that previously fell back to a CSR-only
  build now gets a full `hydrate` factory.
- **Compiler-driven rich data hydration** (`docs/HYDRATION.md` §3.7): a server-rendered
  island's props now cross to the client through a serialized payload — real JS values
  (objects, arrays, numbers), not lossy string attributes. During SSR/SSG, `ssgComponent`
  assigns each island a `data-h` id and records its JSON-safe props into a single
  `<script type="application/json" id="__otfw_h">` payload (injected by `otfw serve` and
  `--ssg`); the hydrate-target component's **constructor** reads `hydrationProps(this)` and
  initializes its prop *signals* from those rich values, falling back to the attribute/default
  when absent (client-created element on SPA nav, or a plain CSR build). This removes the
  per-component serialization boundary, the adopt-then-`setProp` flash, and the dependence on
  a hydrating ancestor to deliver props; `class`/`style` props also resolve to their own value
  rather than the host's merged attribute. Event-callback props are dropped from the payload
  (client-only) and still delivered by the parent walk. New runtime API: `hydrationProps`,
  and `beginHydrationCollect`/`endHydrationCollect` (server). A CSR-only app references no
  hydration helper. `renderRoute()` now also returns `hydration` (the payload JSON).

### Changed

- Hydration: the dual component's build-vs-adopt discriminator is now
  **`isHydrating() && this.firstChild`**, not `this.firstChild` alone (`docs/HYDRATION.md`
  §0/§3.4 — supersedes the earlier "no global flag" decision). The structural test can't
  tell a server-rendered host from a client-`createElement`'d one handed call-site children,
  so it mis-adopted on plain SPA navigation and mangled `{children}` components. Route chunks
  are lazy, so their custom elements upgrade during the router's `await import()`; the router
  now brackets first paint with `beginHydration()` (before the import) / `endHydration()` (in
  `finally`), so upgrading components observe the flag and adopt, while every later navigation
  builds. Adds `beginHydration`/`endHydration` to the runtime.

### Fixed

- Hydration: a **static prop on a server-rendered component now reaches the client**
  (`docs/HYDRATION.md` §3.2). `ssgComponent` reflects nothing onto the component host
  tag, so on adoption the upgrading component read a missing attribute (`null`) and its
  `bindText`/`bindAttr` clobbered the server-rendered value — a blank island. The Hydrate
  codegen now re-applies static component props through `setProp` during the adopt walk
  (exactly as the CSR build arm does), so the prop signal — and the adopted view — carry
  the right value.
- Hydration: an adopt-time **`HydrationMismatch` now recovers per component** (§3.5) —
  it is reported (never silent) and the component rebuilds via CSR through a shared
  `__build` closure; the rest of the page stays hydrated. Non-mismatch errors still route
  to the nearest `<ErrorBoundary>` as before.
- Hydration: the adopt walk now **collects `bindText`/`bindAttr` disposers** (it previously
  emitted them as bare calls), so a hydrated component tears them down on disconnect like
  the CSR path, and a page's partial walk disposes them if it throws a mismatch mid-way —
  no orphaned, double-subscribed effects after the router's fallback rebuild.
- Hydration: a `{children}`-slot component that falls back to rebuild no longer discards
  call-site children on client navigation (the pre-capture clear is now gated on
  `isHydrating()`), and no longer double-wraps its server DOM on first paint.
- Hydration: `skipNode` now asserts the aligned node is a real text node (like its sibling
  claim helpers) and throws `HydrationMismatch` on a cursor misalignment, surfacing the
  desync at the offending step instead of at an unrelated downstream claim.

## [0.6.0] - 2026-07-01

### Added

- Navigation mode (`docs/HYDRATION.md` §7): `mountApp({ nav })` selects `"spa"` (default —
  the client router intercepts same-origin `<Link>` clicks for reload-free navigation) or
  `"mpa"` (every navigation is a full page load; each page hydrates its own first paint).
  MPA is the always-available substrate — `nav` only toggles the SPA enhancement, and in
  MPA mode the router skips the `popstate` listener. `<Link reload>` is a per-link escape
  hatch that forces a full navigation even in SPA mode. `shouldInterceptNav()` exposes the
  current mode to `<Link>`.
- Router first-paint hydration boot switch (Phase 2.0 — see `docs/HYDRATION.md` §3.4):
  `mountApp` detects the server sentinel `data-otfw-hydrate` on the root and, when the
  route module exposes a `hydrate` adopt factory, the router calls it to *adopt* the
  server-rendered DOM instead of `replaceChildren()` + rebuild. Only leaf routes (no
  layout chain) hydrate so far; a missing `hydrate` export, a layout chain, or a thrown
  mismatch (reported via `reportError`, never silent) falls through to a clean CSR build.
  `mountApp` now returns the initial navigation promise.
- Hydration primitives (`runtime/hydrate.js`, Phase 2 foundation — see
  `docs/HYDRATION.md`): a cursor walk that adopts the server DOM instead of rebuilding
  it — `cursor`, `claimElement`, `claimText` (the `<!--$-->…<!--/-->` text-hole scheme),
  `skipNode`, the `isHydrating` / `runHydration` flag, and `HydrationMismatch`. Reactivity
  still wires through the existing `bindText`/`bindAttr`; only node acquisition is new.
  Inert until the Hydrate codegen and client-boot switch consume it.
- `renderRoute` now returns an HTTP `status` alongside `{ html, metadata }`: `200` when
  the path matched a real route, `404` when it fell back to the registered 404 page. The
  new `otfw serve` SSR server uses it to set the response status; SSG ignores it (the
  field is additive, so existing `{ html, metadata }` destructuring is unaffected).
- `web-internal-code-block` built-in (emitted by the MDX front-end as `<CodeFence>`):
  renders a trusted, build-time-highlighted code block like `RawHtml`, but **wires its
  own copy button** on connect. So a code block's copy action works wherever it's
  rendered, with no delegated listener in an ancestor layout. SSG renders the markup
  inline; the behavior wires when the element upgrades in the browser.
- `copyText(text)` and `copyWithFeedback(button, text)` clipboard helpers (async
  Clipboard API with an `execCommand` fallback for non-secure contexts).

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
