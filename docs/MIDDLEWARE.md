# Request Middleware

> **Status:** implemented. Middleware governs the whole request pipeline — pages,
> API endpoints, route-loader data, and 404s alike — under `otfw dev`, `otfw
> serve`, and the deploy adapters. The user-facing contract originates in
> [`SPEC.md`](../SPEC.md) §11.5; the API-route side is documented in
> [`API.md`](./API.md).

---

## 1. Model

A **`_middleware.{js,ts}` file** applies to its folder and everything nested under
it — the same folder-scoping as pages and `route.*` endpoints, so there is no
separate matcher config:

| File | Governs |
|------|---------|
| `app/_middleware.js` | every request |
| `app/admin/_middleware.js` | `/admin` and everything under it |
| `app/api/_middleware.js` | `/api/*` (the classic API guard) |

Middleware are **plain server modules** (never shipped to the client). The default
export (or named `middleware` export) has the signature `(request, context, next)`:

```js
// app/_middleware.js
export default async function (request, context, next) {
  const session = readSession(request.headers.get("cookie"));
  if (!session && new URL(request.url).pathname.startsWith("/dashboard")) {
    return new Response(null, { status: 302, headers: { location: "/login" } });
  }
  context.locals.user = session?.user;     // read by API handlers and loaders
  const res = await next();                // run the rest of the pipeline
  const wrapped = new Response(res.body, res);
  wrapped.headers.set("x-frame-options", "DENY"); // decorate any response
  return wrapped;
}
```

- **Return a `Response`** (or throw one) to short-circuit — auth guards, redirects.
- **`return next()`** to continue to the rest of the chain and, ultimately, the
  route (API dispatch → loader data → SSR / the app shell).
- **`return next(new Request(url, request))`** to *rewrite*: downstream routing
  uses the replacement request (A/B tests, legacy paths, locale tricks).
- **Wrap `next()`'s result** to modify the outgoing response of *any* route —
  security headers, timing, logging.
- Returning nothing (a forgotten `return next()`) is a 500, not a hang.
- An uncaught error is a 500 JSON envelope (`{ "error": "Internal Server Error" }`).

Multiple middleware compose **outermost-first**: `app/_middleware.js` wraps
`app/admin/_middleware.js`, which wraps the route.

## 2. Context

Middleware runs **before routing** (like Next.js middleware), so the context has
no `params`/`query` — no route has matched yet:

| Field | What |
|-------|------|
| `context.url` | the parsed original request `URL` |
| `context.locals` | mutable per-request bag, shared with API handlers (`context.locals`) and route loaders (`locals`) |
| `context.env` / `context.ctx` | the platform `fetch` extras (Workers bindings / `waitUntil`); `undefined` on Bun/Node |

`locals` is the hand-off channel: stamp the authenticated user or a validated
body once, read it in every `route.*` handler and `loader.*` downstream.

## 3. Scope matching — the parts that keep you safe

Two normalizations happen before a pathname is matched against folder scopes:

- **`<path>/__data.json` is governed by its page's scope.** SPA navigation fetches
  loader data from `<path>/__data.json`; a guard on `/admin` also gates
  `/admin/__data.json`, so the data a protected page renders can't be fetched
  around the guard.
- **A non-default locale prefix is stripped** (mirroring the loader registry):
  `/fr/admin` is governed by `app/admin/_middleware.js` too.

**Static assets bypass middleware.** A dotted path that resolves to a real file
(the client bundle, CSS, `public/` files) is served directly — a root auth guard
must not break the login page's stylesheet. A dotted path that is *not* a file
(an `/api/v1.0` endpoint) goes through the pipeline like any other request. To
protect downloadable files, serve them from a `route.*` handler instead.

## 4. Where it runs

- **`otfw dev`** / **`otfw serve`** — the chain wraps API dispatch, the
  `__data.json` endpoint, and SSR / the app shell; rebuilt on edit in dev.
- **`otfw build`** — `dist/server/api.js` exports three composed handlers:
  - `middleware` — the pipeline runner (`createMiddleware`);
  - `apiRoutes` — the routes-only API dispatcher, for servers that run
    `middleware` themselves;
  - `apiHandler` — routes *with* the middleware composed in (standalone use;
    don't combine with `middleware` or it runs twice).
- **Adapters** — `createFetchHandler` takes the runner and wraps everything,
  including the static-asset fallback:

  ```js
  // Cloudflare Workers / Bun / Deno
  import { apiRoutes, middleware } from "./dist/server/api.js";
  import { createFetchHandler } from "@opentf/web/server";
  export default {
    fetch: createFetchHandler(apiRoutes, {
      middleware,
      fallback: (request, env) => env.ASSETS.fetch(request),
    }),
  };
  ```

- **Static hosting** — a pure `otfw build` deployed to a static host has no
  server, so middleware cannot run there (same constraint as every framework).
  Pages that need guarding need `otfw serve` or a server/edge adapter.

## 5. Middleware vs. the client route guard

`app/routeGuard.{js,ts}` runs in the **browser** on SPA navigation — it's UX
(spinners, optimistic redirects), not security: it never sees a first load, curl,
or a crawler. `_middleware.*` runs on the **server** for every request and is
where auth belongs. They compose: the server guard is authoritative; the client
guard keeps the SPA feel.

## 6. TypeScript

```ts
// app/_middleware.ts
import type { Middleware } from "@opentf/web/server";

const guard: Middleware = (request, context, next) => {
  context.locals.user = "ada";
  return next();
};
export default guard;
```

`Middleware`, `MiddlewareContext`, `NextFn`, and `MiddlewareRunner` are exported
from `@opentf/web/server`.
