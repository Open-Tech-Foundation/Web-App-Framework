// File-based API routes for the OTF Web runtime — the API backend (ARCHITECTURE
// §6, SPEC §11). Handlers live in `app/api/**` and are *plain server modules*
// (not JSX/DOM-compiled): each exports named functions per HTTP method that take
// a standard `Request` and return a standard `Response`, so routes are portable
// across Bun / Node / Cloudflare Workers (SPEC §11.1).
//
// This module is runtime-agnostic: `createApiHandler` turns a discovered route
// map into a single `(request) => Response | null` function. `null` means "no
// API route matched" so the caller (dev/serve/adapter) can fall through to SSR
// or a 404. Matching reuses the `[param]` / `[...rest]` convention and regex
// approach of the page router (runtime/router.js `matchRoute`) so behavior is
// identical across pages and API and across every deployment target.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Derive the API route path from a `.../app/api/<...>.{js,ts}` file path.
 * `app/api/status.js` → `/api/status`, `app/api/users/[id].js` → `/api/users/[id]`,
 * `app/api/index.js` → `/api`. Mirrors `routeFromPath` in the page router.
 */
export function apiRouteFromPath(filePath) {
  let r = filePath.replace(/^.*\/app/, "").replace(/\.(jsx?|tsx?)$/, "");
  r = r.replace(/\/index$/, ""); // app/api/index.js → /api
  return r === "" ? "/" : r;
}

/** The folder route a `_middleware.{js,ts}` file governs: `app/api/_middleware.js`
 *  → `/api` (applies to `/api` and everything nested under it). */
export function middlewareScopeFromPath(filePath) {
  const r = filePath.replace(/^.*\/app/, "").replace(/\/_middleware\.(jsx?|tsx?)$/, "");
  return r === "" ? "/" : r;
}

/** Compile a route path with `[param]` / `[...rest]` segments to a matcher regex.
 *  Named groups become route params; the optional trailing slash is tolerated. */
function compilePattern(route) {
  const src = route
    .replace(/\[\.\.\.([^\]]+)\]/g, "(?<$1>.+)")
    .replace(/\[([^\]]+)\]/g, "(?<$1>[^/]+)");
  return new RegExp(`^${src}/?$`);
}

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
 * @returns {(request: Request) => Promise<Response | null>}
 */
export function createApiHandler(routeModules = {}, middlewareModules = {}) {
  const routes = [];
  for (const file in routeModules) {
    const route = apiRouteFromPath(file);
    routes.push({ route, pattern: compilePattern(route), module: routeModules[file], dynamic: route.includes("[") });
  }
  // Static routes before dynamic, longer (more specific) before shorter, so the
  // most specific match wins deterministically regardless of discovery order.
  routes.sort((a, b) => a.dynamic - b.dynamic || b.route.length - a.route.length);

  const middleware = [];
  for (const file in middlewareModules) {
    const mod = middlewareModules[file];
    const fn = mod.default ?? mod.middleware;
    if (typeof fn === "function") middleware.push({ scope: middlewareScopeFromPath(file), fn });
  }
  // Outermost (shortest scope) runs first, so `/api/_middleware` wraps `/api/users/_middleware`.
  middleware.sort((a, b) => a.scope.length - b.scope.length);

  return async function handle(request) {
    const url = new URL(request.url);
    const pathname = normalize(url.pathname);

    let matched = null;
    let params = {};
    for (const r of routes) {
      const m = pathname.match(r.pattern);
      if (!m) continue;
      matched = r;
      params = { ...(m.groups || {}) };
      for (const k in params) {
        if (r.route.includes(`[...${k}]`)) params[k] = params[k].split("/");
      }
      break;
    }
    if (!matched) return null; // no API route — fall through to SSR / 404

    // Shared per-request context. `locals` is the channel middleware uses to pass
    // data (auth user, validated body) down to the handler.
    const context = {
      params,
      query: Object.fromEntries(url.searchParams),
      url,
      locals: {},
    };

    const dispatch = async (req) => {
      const mod = matched.module;
      const method = req.method.toUpperCase();
      const fn = mod[method];
      if (typeof fn === "function") return fn(req, context);
      // Auto HEAD from GET (drop the body); auto OPTIONS; else 405.
      if (method === "HEAD" && typeof mod.GET === "function") {
        const res = await mod.GET(req, context);
        return new Response(null, { status: res.status, headers: res.headers });
      }
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: allowedMethods(mod) } });
      return new Response(null, { status: 405, headers: { Allow: allowedMethods(mod) } });
    };

    // Compose the applicable middleware chain around dispatch (outermost first).
    const chain = middleware.filter((mw) => pathname === mw.scope || pathname.startsWith(mw.scope + "/"));
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
