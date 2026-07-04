# API Routes

> **Status:** Phase A (file-based `Request → Response` handlers) — implemented.
> Phase B (typed server functions / loaders via the Server IR) — designed in
> [`ARCHITECTURE.md`](../ARCHITECTURE.md) §6, not yet built. This document is the
> authoritative usage guide for Phase A; the user-facing contract originates in
> [`SPEC.md`](../SPEC.md) §11.

---

## 1. Model

OTF Web API routes are **plain server modules** — not JSX, not DOM-compiled. Each
handler receives a standard Fetch [`Request`](https://developer.mozilla.org/docs/Web/API/Request)
and returns a standard [`Response`](https://developer.mozilla.org/docs/Web/API/Response),
so routes are portable across Bun, Node 20+, Cloudflare Workers, and Deno.

Because they're plain server code, they're discovered and bundled by the JS
toolchain (not the Rust compiler): `otfw dev` and `otfw serve` mount `/api/*`, and
`otfw build` emits a self-contained `dist/server/api.js` for deployment.

## 2. File-based routing

Routes live under `app/api/`, mapped to the `/api/*` prefix using the same
`[param]` / `[...rest]` convention as pages:

| File | Route |
|------|-------|
| `app/api/status.js` | `/api/status` |
| `app/api/index.js` | `/api` |
| `app/api/users/[id].js` | `/api/users/:id` |
| `app/api/files/[...path].js` | `/api/files/*` (rest → array) |

Static routes take precedence over dynamic ones; a longer (more specific) match
wins. Files whose name starts with `_` (other than `_middleware`) are treated as
private helpers, never routes.

## 3. Method handlers

Export a named function per HTTP method. The second argument is a **context** with
the resolved route params, parsed query, the `URL`, and a mutable `locals` bag.

```js
// app/api/users/[id].js
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

A `_middleware.js` file applies to its folder and everything nested under it.
Multiple middleware compose **outermost-first** (`app/api/_middleware.js` wraps
`app/api/users/_middleware.js`). The signature is `(request, context, next)`; call
`next()` to continue, or return a `Response` to short-circuit. Pass data to
handlers via `context.locals`.

```js
// app/api/_middleware.js
export default function (request, context, next) {
  const token = request.headers.get("authorization");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  context.locals.user = verify(token); // downstream handlers read context.locals.user
  return next();
}
```

Request validation (e.g. with `zod`) belongs here or at the top of a handler.

## 5. Running & deploying

- **`otfw dev`** — `/api/*` is served by a bundle built lazily on first request and
  rebuilt on edit (hot reload).
- **`otfw serve`** — the SSR server tries `/api/*` handlers ahead of assets and SSR;
  a request that matches no handler falls through to the page router, so pages and
  API routes can coexist under `/api` (e.g. the docs site's `/api` reference section).
- **`otfw build`** — emits `dist/server/api.js`, a self-contained ESM module
  exporting `apiHandler(request) => Response | null` (the runtime dispatcher is
  bundled in; your npm/node deps stay external for the target).

### Adapters

`apiHandler` is Fetch-native. Fetch runtimes use it directly:

```js
// Cloudflare Workers / Bun / Deno
import { apiHandler } from "./dist/server/api.js";
import { createFetchHandler } from "@opentf/web/server";
export default { fetch: createFetchHandler(apiHandler) };
```

Node uses the `node:http` adapter:

```js
import { createServer } from "node:http";
import { apiHandler } from "./dist/server/api.js";
import { toNodeListener } from "@opentf/web/server/adapters/node";
createServer(toNodeListener(apiHandler)).listen(3000);
```

## 6. Environment variables

Server-only secrets in `.env` are available to handlers via `process.env`. Only
`PUBLIC_`-prefixed variables are ever exposed to the client bundle (SPEC §14).

## 7. Phase B (planned)

Typed **server functions** and page **loaders/actions** callable from components —
the compiler (Metadata + Server IR, ARCHITECTURE §4.4) splits the client/server
boundary and generates the client-side `fetch`. This turns the Server IR
placeholder into real lowering and is tracked separately from Phase A.
