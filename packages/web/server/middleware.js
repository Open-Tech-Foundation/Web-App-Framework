// Request middleware for the OTF Web servers (SPEC §11.5, docs/MIDDLEWARE.md). A
// `_middleware.{js,ts}` file applies to its folder and everything nested under it —
// pages, API endpoints, route-loader data requests, and 404s alike, not just
// `/api/*`. `createMiddleware` turns a discovered `{ absFilePath: namespace }` map
// into a runner the server wraps around its whole request pipeline:
//
//   const res = await middleware.run(request, terminal);   // terminal: (req, context) => Response
//
// Middleware runs *before* routing (like Next.js's middleware), so it can gate a
// page, stamp `context.locals` for API handlers and loaders, add headers to any
// response (it wraps `next()`), or rewrite the request by calling
// `next(new Request(url, request))` — the terminal routes on the rewritten request.
//
// Scope matching is security-aware in two ways the raw pathname isn't:
//   • a `<path>/__data.json` loader-data request is governed by the *page's* scope
//     (a guard on `/admin` must also gate `/admin/__data.json`, or SPA navigation
//     would leak the protected loader payload);
//   • a non-default locale prefix is stripped (`/fr/admin` is governed by `/admin`
//     middleware), mirroring the loader registry (loader.js `match`).

import { DATA_FILE } from "../runtime/route-data.js";

/** See `stripAppDir` in api.js — exact-prefix strip with a `/app` segment fallback. */
function stripAppDir(filePath, appDir) {
  if (appDir) {
    const base = appDir.replace(/\/+$/, "");
    if (filePath.startsWith(base + "/")) return filePath.slice(base.length);
  }
  return filePath.replace(/^.*\/app(?=\/)/, "");
}

/** The folder route a `_middleware.{js,ts}` file governs: `app/api/_middleware.js`
 *  → `/api` (applies to `/api` and everything nested under it); `app/_middleware.js`
 *  → `/` (every request). */
export function middlewareScopeFromPath(filePath, appDir) {
  const r = stripAppDir(filePath, appDir).replace(/\/_middleware\.(jsx?|tsx?)$/, "");
  return r === "" ? "/" : r;
}

const normalize = (p) => (p || "/").replace(/(.)\/+$/, "$1");

/**
 * Build the middleware runner from a discovered `{ absFilePath: namespace }` map.
 *
 * @param {Record<string, object>} middlewareModules  the middleware is each
 *        module's default (or named `middleware`) export.
 * @param {{ appDir?: string, i18n?: { locales?: string[], defaultLocale?: string } }} [options]
 *        `appDir` pins exact scope derivation; `i18n` lets scope matching strip a
 *        leading non-default locale prefix (mirroring the loader registry).
 * @returns {{ size: number, scopes: string[],
 *             run: (request: Request,
 *                   terminal: (req: Request, context: object) => Response | Promise<Response>,
 *                   extras?: { env?: unknown, ctx?: unknown }) => Promise<Response> }}
 */
export function createMiddleware(middlewareModules = {}, { appDir, i18n } = {}) {
  const entries = [];
  for (const file in middlewareModules) {
    const mod = middlewareModules[file];
    const fn = mod.default ?? mod.middleware;
    if (typeof fn === "function") entries.push({ scope: middlewareScopeFromPath(file, appDir), fn });
  }
  // Outermost (shortest scope) runs first, so `app/_middleware` wraps `app/api/_middleware`.
  entries.sort((a, b) => a.scope.length - b.scope.length);

  const i18nOn = !!(i18n && Array.isArray(i18n.locales) && i18n.locales.length);
  const defaultLocale = i18nOn ? (i18n.defaultLocale ?? i18n.locales[0]) : null;
  const nonDefault = i18nOn ? new Set(i18n.locales.filter((l) => l !== defaultLocale)) : null;

  // The pathname scopes match against: `__data.json` stripped to its page path,
  // locale prefix stripped (see the header comment for why both matter).
  function scopePath(pathname) {
    let path = normalize(pathname);
    if (path === `/${DATA_FILE}`) path = "/";
    else if (path.endsWith(`/${DATA_FILE}`)) path = path.slice(0, -(DATA_FILE.length + 1)) || "/";
    if (nonDefault) {
      const m = path.match(/^\/([^/]+)(\/.*|)$/);
      if (m && nonDefault.has(m[1])) path = m[2] === "" || m[2] === "/" ? "/" : m[2];
    }
    return path;
  }

  /**
   * Run the applicable middleware chain around `terminal`. The shared `context`
   * (`{ url, locals, env, ctx }`) is handed to every middleware and to the
   * terminal — `locals` is the channel middleware uses to pass data (auth user,
   * validated body) down to API handlers and route loaders. There are no `params`:
   * middleware runs before routing, so no route has matched yet.
   *
   * Each middleware is `(request, context, next)`; `next()` continues with the
   * current request, `next(rewrittenRequest)` re-routes downstream. A returned or
   * thrown `Response` short-circuits; any other throw is a 500. Returning nothing
   * (a forgotten `return next()`) is an error, not a hang.
   */
  async function run(request, terminal, { env, ctx } = {}) {
    const url = new URL(request.url);
    const context = { url, locals: {}, env, ctx };
    const path = scopePath(url.pathname);
    const chain = entries.filter((e) => e.scope === "/" || path === e.scope || path.startsWith(e.scope + "/"));
    let next = (req) => terminal(req, context);
    for (let i = chain.length - 1; i >= 0; i--) {
      const { fn } = chain[i];
      const downstream = next;
      next = (req) => fn(req, context, (nextReq) => downstream(nextReq instanceof Request ? nextReq : req));
    }
    try {
      const res = await next(request);
      if (res instanceof Response) return res;
      throw new Error(
        `middleware for ${request.method} ${url.pathname} returned no Response (did you forget to return next()?)`,
      );
    } catch (e) {
      if (e instanceof Response) return e; // middleware may throw a Response
      console.error(`✗ middleware ${request.method} ${url.pathname}:`, e?.stack ?? e);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  return { size: entries.length, scopes: entries.map((e) => e.scope), run };
}
