// File-based API routes for the OTF Web runtime — the API backend (ARCHITECTURE
// §6, SPEC §11). An endpoint is a `route.{js,ts}` file — the API analogue of a
// page's `page.{jsx,tsx}` — so the folder is the URL (`app/api/users/[id]/route.ts`
// → `/api/users/:id`), exactly like pages. Handlers are *plain server modules*
// (not JSX/DOM-compiled): each exports named functions per HTTP method that take a
// standard `Request` and return a standard `Response`, portable across Bun / Node /
// Cloudflare Workers (SPEC §11.1). A folder may hold a `page.*` or a `route.*`, not
// both — the toolchain errors on the conflict (like Next.js's App Router).
//
// This module is runtime-agnostic: `createApiHandler` turns a discovered route
// map into a single `(request) => Response | null` function. `null` means "no
// API route matched" so the caller (dev/serve/adapter) can fall through to SSR
// or a 404. Matching reuses the `[param]` / `[...rest]` convention and regex
// approach of the page router (runtime/router.js `matchRoute`) so behavior is
// identical across pages and API and across every deployment target.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Strip the app-directory prefix from a route/middleware file path. When the
 * caller knows the app dir (the CLI always does), the exact prefix is removed —
 * unambiguous even for an `app/app/...` folder. Without it, fall back to the last
 * complete `/app` path segment; the lookahead keeps folders that merely *start*
 * with "app" (`/appointments`, `/apps`) intact.
 */
function stripAppDir(filePath, appDir) {
  if (appDir) {
    const base = appDir.replace(/\/+$/, "");
    if (filePath.startsWith(base + "/")) return filePath.slice(base.length);
  }
  return filePath.replace(/^.*\/app(?=\/)/, "");
}

/**
 * Derive the API route path from a `.../app/<...>/route.{js,ts}` file path — the
 * folder is the URL, mirroring `routeFromPath` in the page router.
 * `app/api/status/route.js` → `/api/status`, `app/api/users/[id]/route.ts` →
 * `/api/users/[id]`, `app/route.js` → `/`. Pass `appDir` (the absolute app
 * directory) when known so the prefix is stripped exactly.
 */
export function apiRouteFromPath(filePath, appDir) {
  const r = stripAppDir(filePath, appDir).replace(/\/route\.(jsx?|tsx?)$/, "");
  return r === "" ? "/" : r;
}

/** The folder route a `_middleware.{js,ts}` file governs: `app/api/_middleware.js`
 *  → `/api` (applies to `/api` and everything nested under it). */
export function middlewareScopeFromPath(filePath, appDir) {
  const r = stripAppDir(filePath, appDir).replace(/\/_middleware\.(jsx?|tsx?)$/, "");
  return r === "" ? "/" : r;
}

/** Compile a route path with `[param]` / `[...rest]` segments to a matcher regex.
 *  Named groups become route params; literal parts are regex-escaped (a `v1.0`
 *  folder must not match `v1X0`); the optional trailing slash is tolerated. */
function compilePattern(route) {
  const src = route
    .split(/(\[\.\.\.[^\]]+\]|\[[^\]]+\])/)
    .map((part) => {
      if (part.startsWith("[...")) return `(?<${part.slice(4, -1)}>.+)`;
      if (part.startsWith("[")) return `(?<${part.slice(1, -1)}>[^/]+)`;
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${src}/?$`);
}

// Percent-decode a matched param segment; malformed input stays raw rather than throwing.
const decodeParam = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const normalize = (p) => (p || "/").replace(/(.)\/+$/, "$1");

/** The `Allow` header value for a handler module: the methods it exports, plus the
 *  auto-provided HEAD (when GET exists) and OPTIONS. */
function allowedMethods(mod) {
  const set = new Set(METHODS.filter((m) => typeof mod[m] === "function"));
  if (set.has("GET")) set.add("HEAD");
  set.add("OPTIONS");
  return [...set].join(", ");
}

/**
 * Build the API request handler from a discovered route + middleware map.
 *
 * @param {Record<string, object>} routeModules  `{ [absFilePath]: moduleNamespace }`
 *        — each module exports method handlers (`GET`, `POST`, …).
 * @param {Record<string, object>} middlewareModules  `{ [absFilePath]: moduleNamespace }`
 *        for `_middleware.{js,ts}` files; the middleware is the default export.
 * @param {{ appDir?: string }} [options]  `appDir` — the absolute app directory the
 *        module keys live under, for exact route derivation (the CLI passes it).
 * @returns {(request: Request) => Promise<Response | null>}
 */
export function createApiHandler(routeModules = {}, middlewareModules = {}, { appDir } = {}) {
  const routes = [];
  for (const file in routeModules) {
    const route = apiRouteFromPath(file, appDir);
    routes.push({ route, pattern: compilePattern(route), module: routeModules[file], dynamic: route.includes("[") });
  }
  // Static routes before dynamic, longer (more specific) before shorter, so the
  // most specific match wins deterministically regardless of discovery order.
  routes.sort((a, b) => a.dynamic - b.dynamic || b.route.length - a.route.length);

  const middleware = [];
  for (const file in middlewareModules) {
    const mod = middlewareModules[file];
    const fn = mod.default ?? mod.middleware;
    if (typeof fn === "function") middleware.push({ scope: middlewareScopeFromPath(file, appDir), fn });
  }
  // Outermost (shortest scope) runs first, so `/api/_middleware` wraps `/api/users/_middleware`.
  middleware.sort((a, b) => a.scope.length - b.scope.length);

  return async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = normalize(url.pathname);

    let matched = null;
    let params = {};
    for (const r of routes) {
      const m = pathname.match(r.pattern);
      if (!m) continue;
      matched = r;
      params = { ...(m.groups || {}) };
      // Params reach handlers percent-decoded (`/users/John%20Doe` → "John Doe");
      // catch-all segments are split first so an encoded `%2F` never adds a segment.
      for (const k in params) {
        params[k] = r.route.includes(`[...${k}]`)
          ? params[k].split("/").map(decodeParam)
          : decodeParam(params[k]);
      }
      break;
    }
    if (!matched) return null; // no API route — fall through to SSR / 404

    // Shared per-request context. `locals` is the channel middleware uses to pass
    // data (auth user, validated body) down to the handler. `env`/`ctx` are the
    // platform's fetch arguments — on Cloudflare Workers `env` holds the bindings
    // (D1, KV, secrets) and `ctx` the execution context (`waitUntil`); on Bun/Node
    // they're absent and env vars are read from `process.env` instead.
    const context = {
      params,
      query: Object.fromEntries(url.searchParams),
      url,
      locals: {},
      env,
      ctx,
    };

    const dispatch = async (req) => {
      const mod = matched.module;
      const method = req.method.toUpperCase();
      const fn = mod[method];
      if (typeof fn === "function") return fn(req, context);
      // Auto HEAD from GET (drop the body); auto OPTIONS; else 405.
      if (method === "HEAD" && typeof mod.GET === "function") {
        const got = await mod.GET(req, context);
        // GET may lean on the plain-value → JSON convenience; HEAD must then carry
        // the same status/headers that GET response would have had.
        const res = got instanceof Response ? got : Response.json(got);
        return new Response(null, { status: res.status, headers: res.headers });
      }
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: allowedMethods(mod) } });
      return new Response(null, { status: 405, headers: { Allow: allowedMethods(mod) } });
    };

    // Compose the applicable middleware chain around dispatch (outermost first).
    // The root scope ("/", from an `app/_middleware.*`) governs every route.
    const chain = middleware.filter(
      (mw) => mw.scope === "/" || pathname === mw.scope || pathname.startsWith(mw.scope + "/"),
    );
    let next = dispatch;
    for (let i = chain.length - 1; i >= 0; i--) {
      const { fn } = chain[i];
      const downstream = next;
      next = (req) => fn(req, context, () => downstream(req));
    }

    try {
      const res = await next(request);
      if (res instanceof Response) return res;
      if (res === undefined) {
        throw new Error(`API handler for ${request.method} ${pathname} returned no Response`);
      }
      return Response.json(res); // lenient: a plain value becomes a JSON response
    } catch (e) {
      if (e instanceof Response) return e; // handlers/middleware may throw a Response
      console.error(`✗ API ${request.method} ${pathname}:`, e?.stack ?? e);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
  };
}

/**
 * Wrap an API handler (`(request) => Response | null`) into a total Fetch handler
 * that always returns a `Response` — a `null` (no route matched) becomes the
 * optional `fallback(request, env, ctx)` or a 404. Fetch-native runtimes (Bun,
 * Cloudflare Workers, Deno) can export it directly; the runtime's `fetch`
 * arguments (`env`, `ctx`) are threaded through to handlers and the fallback, so
 * on Workers your handlers reach the bindings via `context.env` and a static-asset
 * fallback reaches `env.ASSETS`:
 *
 *   import { apiHandler } from "./dist/server/api.js";
 *   export default {
 *     fetch: createFetchHandler(apiHandler, {
 *       fallback: (req, env) => env.ASSETS.fetch(req), // SPA / static assets
 *     }),
 *   };
 */
export function createFetchHandler(handler, { fallback } = {}) {
  return async (request, env, ctx) => {
    const res = await handler(request, env, ctx);
    if (res) return res;
    return fallback ? fallback(request, env, ctx) : new Response("Not Found", { status: 404 });
  };
}
