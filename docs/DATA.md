# Data Fetching

Route loaders (server data for pages) and `resource()` (client-side async data) —
the runtime/toolchain half of the data-fetching story (SPEC §7.4, §8.7). The
compiler half (co-located `export loader`, server functions, actions via the
Server IR — ARCHITECTURE §4.4) is Phase B and builds on the contracts fixed here.

## 1. Model

Two primitives, one per side of the network:

- **Route loaders** — a server-only `loader.{js,ts}` file sibling to a `page.*`
  runs before the page renders (SSG build, SSR request, or SPA navigation) and
  its JSON result reaches the page as the reactive `router.data`.
- **`resource()`** — a client-side primitive (`@opentf/web`) wrapping a fetcher
  in signals: `{ data, loading, error, refetch }`, with abort + staleness
  handling. For data the page can fetch *after* paint, or that changes with
  client state.

Rule of thumb: content the server should render (SEO, first paint) → loader;
per-user/interactive data → `resource()`.

## 2. Route loaders

### File convention

```
app/todos/page.jsx        → the page
app/todos/loader.js       → its loader (folder = URL, like route.{js,ts})
app/items/[id]/loader.ts  → dynamic params, same [param]/[...rest] rules
```

Strictly `js|ts` (loaders are plain server modules, never JSX). A `loader.*`
without a sibling `page.*` — including one placed next to a `route.*` endpoint —
is a build error (`detectLoaderConflicts`, web-cli shared.js).

### Signature

```js
export default async function loader({ params, query, request, locale, locals }) {
  return db.todos.list();   // any JSON-serializable value
}
```

A named `loader` export is also accepted — the spelling Phase B's co-located
form will compile to. `request` is the live Fetch `Request` under `otfw serve`/
`dev` and `undefined` at SSG prerender. `locals` is the per-request bag stamped
by `_middleware.*` (docs/MIDDLEWARE.md) — empty (`{}`) at SSG prerender, where
no middleware runs. `getStaticPaths` stays on the page module — a dynamic route
with a loader still needs it to prerender.

### Where it runs (D2: a separate server bundle)

Loaders bundle like API routes — plain server ESM, no DOM transform, npm/node
imports external (`buildLoaderBundle`/`emitLoaderBundle` → `dist/server/loaders.js`)
— NOT into the SSG server bundle, so DB drivers stay external and a loader edit
never rebuilds the SSG graph. Consequence: the loader bundle is a separate module
graph from the render bundle, so:

- the **caller** (serve/prerender) runs the loader and passes the result into
  `renderRoute(path, params, search, { data })` as a plain value;
- cross-bundle error checks are **property-based** (`e.otfwNotFound === true`
  via `isNotFound`), never `instanceof`.

The registry (`createLoaderRegistry`, `@opentf/web/server`) owns matching
(`[param]`/`[...rest]`, percent-decoding, trailing slashes, i18n locale-prefix
stripping), running (`load`/`loadSerialized`), and the HTTP endpoint (`handle`).

### The wire format (D3/D4)

- **First paint** (SSR and prerendered pages): the data is inlined as
  `<script type="application/json" id="__otfw_data">…</script>` — a sibling of,
  and independent from, the `__otfw_h` island-props payload. `<` is escaped to
  `<` (`serializeRouteData`) so the payload cannot close the script. The
  client router reads it once at hydration (`readInlineRouteData`).
- **SPA navigation**: the router fetches `GET <path>/__data.json` (+ the query
  string). Under `--ssg`, the *same* URL is written as a literal file next to
  each page's `index.html` (per locale), so a plain static host serves it with
  no server. `__data.json` is a **reserved filename**.
- **Endpoint contract**: 200 = the raw loader JSON (no envelope — byte-identical
  to the static file; an `undefined` result is written as `null` so a 200 always
  parses), `content-type: application/json`, `cache-control: no-store` under
  serve/dev (static hosts set their own caching). 404 = no loader or
  `notFound()`. 5xx = the loader threw. GET/HEAD only (405 otherwise). A data
  URL that matches no loader returns 404 — the suffix never falls through to
  SSR (a catch-all page would otherwise swallow it) or to static assets.

### The client (D5)

`mountApp({ loaders: ["/todos", "/items/[id]"] })` — the toolchain bakes the
loader route *patterns* into the entry; `matchRoute` returns the same pattern
string, so membership is a Set lookup. In `navigate()`:

1. after the guard and route match, **before** any state write / history push /
   DOM swap, the data resolves (inline payload on hydration, endpoint fetch
   otherwise) — fetch-then-commit, like guards;
2. a navigation-sequence token discards a superseded navigation's late data;
3. a 404 maps to `data === undefined`; a failed fetch is `reportError`ed
   (`phase: "data"`) and the navigation still commits with `undefined`.

Pages read the reactive **`router.data`** (the compiler does not emit page props
yet — same reason as `router.params`).

### Error semantics

`notFound()` (`@opentf/web/server`) → SSR renders the registered 404 page with
HTTP 404; the data endpoint 404s; prerender records the path as failed. Any
other throw → 500 (page and endpoint). Redirects from loaders are **out of
scope** until actions/Phase B.

### Known limits (MVP)

- Page-level only; no layout loaders.
- Query-dependent loaders need `otfw serve` — static `__data.json` files are
  rendered with an empty query.
- No streaming; the navigation waits for the data.
- `generateMetadata` does not see loader data.

## 3. `resource()`

```js
const users = resource(() => fetch("/api/users").then((r) => r.json()));
const user  = resource(() => router.params.id,
  (id, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
  { initial: null });
```

Semantics (runtime/resource.js): reactive getters `{ data, loading, error,
refetch }`; one tracked read (the source) per run; each run aborts the previous
run's `AbortController` and bumps a token so out-of-order resolutions are
discarded; a rejection sets `error` and keeps the last good `data`; a `null`/
`false` source pauses fetching; effect disposal (region teardown via `scope()`)
aborts in-flight work. On the server no effect is created and `loading` stays
`true`, so SSG renders the loading branch — identical to the client's first
paint, keeping hydration adoption aligned.

## 4. Toolchain

- `otfw dev` — loader bundle built lazily on the first `__data.json` request,
  invalidated by the watcher on `loader.*` edits (the entry is rewritten too:
  the loader route set is baked into it). Rebuilds emit a **versioned filename**
  (`loaders.<n>.js`) because Bun's ESM cache ignores `?v=` on file URLs.
- `otfw build` — `dist/server/loaders.js` (emitted before prerender); with
  `--ssg`, prerender runs each matched loader (empty query, no request), inlines
  the payload, and writes the per-locale `__data.json` files.
- `otfw serve` — imports `dist/server/loaders.js`; per request runs the loader
  before `renderRoute` and answers the data endpoint (checked after API routes,
  before the static-asset branch — the suffix has a file extension).

## 5. Phase B forward-compatibility

The compiler will later parse a co-located `export async function loader()` in
`page.jsx`, strip it from CSR/SSG/hydrate outputs (Server IR,
`crates/otfw_ir/src/server.rs`), and emit a synthetic server module registered
into the **same** `loaderEntrySource` map. Everything downstream is discovery-
agnostic and stays stable: the wire format (`<path>/__data.json`, `#__otfw_data`),
the runtime API (`router.data`, `registerLoaderRoutes`, `createLoaderRegistry`),
and the bundling path. Sibling `loader.{js,ts}` files remain supported. Actions
get their own endpoint namespace — `__data.json` stays GET/HEAD-only.
