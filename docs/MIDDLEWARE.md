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
import { getCookie } from "@opentf/web/server";

export default async function (request, context, next) {
  const session = verify(getCookie(request, "session"));
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

## 3. Cookies

`@opentf/web/server` ships standards-based cookie helpers, so nothing hand-rolls
`Cookie` / `Set-Cookie` header handling:

```js
import { getCookie, getCookies, setCookie, deleteCookie } from "@opentf/web/server";

// read — works on a Request, a Headers, or the raw header string
const theme = getCookie(request, "theme");        // string | undefined
const all = getCookies(request);                  // { name: value }

// write — appends Set-Cookie to a Response (or Headers); appends, never
// overwrites, so session + CSRF cookies coexist on one response
const res = Response.json({ ok: true });
setCookie(res, "session", token, { httpOnly: true, secure: true, maxAge: 3600 });
deleteCookie(res, "legacy");                      // Max-Age=0 + epoch Expires
```

Values percent-encode on write and decode on read, so any string round-trips.
`path` defaults to `"/"` (the spec's request-path default is a footgun; pass
`path: null` to opt out), and `sameSite: "None"` without `secure: true` throws at
write time — browsers would silently drop the cookie otherwise. `serializeCookie`
is exported too for building a `Set-Cookie` string by hand. To set cookies on a
response coming *out* of `next()`, wrap it first (`new Response(res.body, res)`)
— a fetched response's headers are immutable.

## 4. Scope matching — the parts that keep you safe

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

## 5. Where it runs

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

## 6. Middleware vs. the client route guard

`app/routeGuard.{js,ts}` runs in the **browser** on SPA navigation — it's UX
(spinners, optimistic redirects), not security: it never sees a first load, curl,
or a crawler. `_middleware.*` runs on the **server** for every request and is
where auth belongs. They compose: the server guard is authoritative; the client
guard keeps the SPA feel.

## 7. TypeScript

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
from `@opentf/web/server`, as are the cookie types (`CookieOptions`,
`CookieSource`, `CookieTarget`).
