# API Routes

> **Status:** Phase A (file-based `Request → Response` handlers) — implemented.
> Phase B (typed server functions / loaders via the Server IR) — designed in
> [`ARCHITECTURE.md`](../ARCHITECTURE.md) §6, not yet built. This document is the
> authoritative usage guide for Phase A; the user-facing contract originates in
> [`SPEC.md`](../SPEC.md) §11.

---

## 1. Model

An endpoint is a **`route.{js,ts}` file** — the API analogue of a page's
`page.{jsx,tsx}`. Its **folder is the URL**, exactly like pages. Handlers are
**plain server modules** (not JSX, not DOM-compiled): each receives a standard
Fetch [`Request`](https://developer.mozilla.org/docs/Web/API/Request) and returns a
standard [`Response`](https://developer.mozilla.org/docs/Web/API/Response), so they
run unchanged on Bun, Node 20+, Cloudflare Workers, and Deno.

Because they're plain server code, they're discovered and bundled by the JS
toolchain (not the Rust compiler): `otfw dev` and `otfw serve` serve them, and
`otfw build` emits a self-contained `dist/server/api.js` for deployment.

## 2. File-based routing

A `route.{js,ts}` file works in **any folder** under `app/` (conventionally
`app/api/`); the folder is the URL, using the same `[param]` / `[...rest]`
convention as pages:

| File | Route |
|------|-------|
| `app/api/status/route.js` | `/api/status` |
| `app/api/route.js` | `/api` |
| `app/api/users/[id]/route.js` | `/api/users/:id` |
| `app/api/files/[...path]/route.js` | `/api/files/*` (rest → array) |

Static routes take precedence over dynamic ones; a longer (more specific) match
wins. A folder may hold a `page.*` **or** a `route.*`, not both — the toolchain
errors on the conflict (as in Next.js's App Router).

## 3. Method handlers

Export a named function per HTTP method. The second argument is a **context** with
the resolved route params, parsed query, the `URL`, a mutable `locals` bag, and —
on runtimes that pass them through `fetch` (Cloudflare Workers) — the platform
`env` (bindings: `env.DB` for D1, KV, secrets) and `ctx` (`ctx.waitUntil`).

```js
// app/api/users/[id]/route.js
export async function GET(request, { params, query }) {
  const user = await db.users.find(params.id);
  return user ? Response.json(user) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request, { params }) {
  const data = await request.json();
  const user = await db.users.update(params.id, data);
  return Response.json(user, { status: 201 });
}
```

- `HEAD` is auto-derived from `GET` (headers only, no body).
- `OPTIONS` is auto-answered (`204` + `Allow`) unless you export your own.
- A request to a matched path with an unhandled method → `405` with an `Allow` header.
- A handler may **throw a `Response`** to short-circuit (e.g. a guard).
- Returning a non-`Response` value is a convenience: it's JSON-encoded.

## 4. Middleware

A `_middleware.js` file applies to its folder and everything nested under it —
and not just to API routes: middleware governs the **whole request pipeline**
(pages, endpoints, loader data, 404s). The full contract lives in
[`MIDDLEWARE.md`](./MIDDLEWARE.md); the short version:

Multiple middleware compose **outermost-first** (`app/_middleware.js` wraps
`app/api/_middleware.js`). The signature is `(request, context, next)`; call
`next()` to continue (or `next(new Request(...))` to rewrite), or return a
`Response` to short-circuit. Pass data to handlers via `context.locals`.

```js
// app/api/_middleware.js
export default function (request, context, next) {
  const token = request.headers.get("authorization");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  context.locals.user = verify(token); // downstream handlers read context.locals.user
  return next();
}
```

Middleware runs **before routing**, so its context has no `params`/`query` —
read those in the handler. Request validation (e.g. with `zod`) belongs here or
at the top of a handler.

Cookie handling is covered by the standards-based helpers `getCookie` /
`getCookies` / `setCookie` / `deleteCookie` / `serializeCookie` from
`@opentf/web/server` — see [`MIDDLEWARE.md`](./MIDDLEWARE.md) §3.

## 5. TypeScript

Author handlers in `.ts` and annotate the exports:

```ts
// app/api/users/[id]/route.ts
import type { ApiHandler, Middleware } from "@opentf/web/server";

export const GET: ApiHandler = (request, { params }) => Response.json({ id: params.id });
```

`ApiHandler`, `Middleware`, `ApiContext`, and `RouteParams` are exported from
`@opentf/web/server`.

## 6. Running & deploying

- **`otfw dev`** — endpoints are served by a bundle built lazily on first request and
  rebuilt on edit (hot reload).
- **`otfw serve`** — the SSR server tries a matching `route.*` handler ahead of SSR;
  a request that matches no handler falls through to the page router, so pages and
  endpoints coexist (only a *same-folder* `page.*` + `route.*` is rejected).
- **`otfw build`** — emits `dist/server/api.js`, a self-contained ESM module (the
  runtime dispatchers are bundled in; your npm/node deps stay external for the
  target) exporting three handlers:
  - `apiRoutes(request) => Response | null` — routes only;
  - `middleware` — the request-middleware runner (docs/MIDDLEWARE.md);
  - `apiHandler(request) => Response | null` — routes with the middleware
    composed in, for standalone use (don't pair it with `middleware`, or the
    middleware runs twice).

### Adapters

The handlers are Fetch-native. Fetch runtimes use them directly; the runtime's
`fetch` `env`/`ctx` are threaded to middleware and handlers
(`context.env`/`context.ctx`) and to the `fallback`, so a Worker can serve static
assets from its `env.ASSETS` binding — with `middleware` wrapping the fallback
too, so page URLs served from `ASSETS` are still guarded:

```js
// Cloudflare Workers / Bun / Deno
import { apiRoutes, middleware } from "./dist/server/api.js";
import { createFetchHandler } from "@opentf/web/server";
export default {
  fetch: createFetchHandler(apiRoutes, {
    middleware, // omit if the app has none
    fallback: (request, env) => env.ASSETS.fetch(request), // static assets / SPA
  }),
};
```

Node uses the `node:http` adapter:

```js
import { createServer } from "node:http";
import { apiHandler } from "./dist/server/api.js";
import { toNodeListener } from "@opentf/web/server/adapters/node";
createServer(toNodeListener(apiHandler)).listen(3000);
```

For a full full-stack Cloudflare setup (Worker entry, `wrangler.jsonc`, D1, and the
dev proxy), see the website's [Cloudflare Workers](https://github.com/Open-Tech-Foundation/Web-App-Framework/blob/main/website/app/docs/deployment/cloudflare/page.mdx)
deployment guide.

### Development with bindings (D1) — the dev proxy

Bindings like D1 exist only inside the Workers runtime, so in dev run the API on
`wrangler dev` and forward `/api/*` to it from `otfw.config.js` — the same handler
code runs in dev and production, against a real local D1:

```js
// otfw.config.js
export default { proxy: { "/api": "http://localhost:8787" } };
```

`otfw dev` then serves the SPA (with HMR) and proxies matched prefixes to the
upstream. The `proxy` config is **dev-only** — it has no effect on `otfw build`.

## 7. Environment variables

Server-only secrets in `.env` are available to handlers via `process.env`. Only
`PUBLIC_`-prefixed variables are ever exposed to the client bundle (SPEC §14).

## 8. Phase B (planned)

Typed **server functions** and **actions** callable from components — the compiler
(Metadata + Server IR, ARCHITECTURE §4.4) splits the client/server boundary and
generates the client-side `fetch`. This turns the Server IR placeholder into real
lowering and is tracked separately from Phase A.

Page **loaders** shipped ahead of Phase B in runtime/toolchain form — a
`loader.{js,ts}` file sibling to a page, feeding the reactive `router.data`
(see [docs/DATA.md](DATA.md)). Phase B adds the co-located `export loader`
spelling on top of the same wire format and runtime API.
