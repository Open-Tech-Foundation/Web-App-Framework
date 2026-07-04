// Route loaders — the server half of data fetching (docs/DATA.md, SPEC §8). A
// loader is a `loader.{js,ts}` file sibling to a `page.*` (the data analogue of
// a `route.*` API endpoint): a *plain server module* whose default export (or
// named `loader` export, the Phase B compiler convention) returns the page's
// JSON-serializable data:
//
//   export default async function loader({ params, query, request, locale, locals }) {
//     return db.todos.list();
//   }
//
// `createLoaderRegistry` turns a discovered `{ absFilePath: namespace }` map into
// a matcher + runner shared by every consumer: SSG prerender (build time, no
// `request`), the SSR server (per request), the dev server, and the
// `<path>/__data.json` HTTP endpoint SPA navigation fetches from (`handle`).
//
// Matching duplicates the `[param]` / `[...rest]` compile/decode approach of the
// API handler (api.js) — like api.js itself mirrors the page router — so params
// behave identically across pages, endpoints, and loaders.

import { DATA_FILE } from "../runtime/route-data.js";

/** See `stripAppDir` in api.js — exact-prefix strip with a `/app` segment fallback. */
function stripAppDir(filePath, appDir) {
  if (appDir) {
    const base = appDir.replace(/\/+$/, "");
    if (filePath.startsWith(base + "/")) return filePath.slice(base.length);
  }
  return filePath.replace(/^.*\/app(?=\/)/, "");
}

/** The page route a `.../app/<...>/loader.{js,ts}` file feeds (folder = URL):
 *  `app/todos/loader.js` → `/todos`, `app/loader.js` → `/`. */
export function loaderRouteFromPath(filePath, appDir) {
  const r = stripAppDir(filePath, appDir).replace(/\/loader\.(js|ts)$/, "");
  return r === "" ? "/" : r;
}

/** Compile a route with `[param]` / `[...rest]` segments to a matcher regex (see api.js). */
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

const decodeParam = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const normalize = (p) => (p || "/").replace(/(.)\/+$/, "$1");

/**
 * Signal "this page does not exist for these params" from inside a loader — the
 * SSR server responds 404 (rendering the 404 page), the data endpoint returns a
 * 404 the client maps to `undefined`, and SSG records the path as failed.
 */
export function notFound(message = "Not Found") {
  const e = new Error(message);
  e.name = "NotFoundError";
  // A marker property, not a class: the loader bundle and the server bundle are
  // separate module graphs (each bundles its own copy of this file), so an
  // `instanceof` check would fail across the boundary.
  e.otfwNotFound = true;
  throw e;
}

/** Was `e` thrown by {@link notFound}? (Property check — see the note there.) */
export function isNotFound(e) {
  return e?.otfwNotFound === true;
}

/**
 * Serialize loader data for embedding: the inline `#__otfw_data` script and the
 * static `__data.json` file must carry identical bytes. `<` is escaped so the
 * payload can never close the inline `<script>` (same rule as the island-props
 * collector in ssg-runtime.js). `undefined` (no data) serializes to `""` — the
 * toolchain skips injection entirely.
 */
export function serializeRouteData(value) {
  const json = JSON.stringify(value);
  return json === undefined ? "" : json.replace(/</g, "\\u003c");
}

/**
 * Build the loader registry from a discovered `{ absFilePath: namespace }` map.
 *
 * @param {Record<string, object>} loaderModules  each module's default (or `loader`)
 *        export is the loader function.
 * @param {{ appDir?: string, i18n?: { locales?: string[], defaultLocale?: string } }} [options]
 *        `appDir` pins exact route derivation; `i18n` lets `match` strip a leading
 *        non-default locale prefix (`/fr/todos` matches the `/todos` loader with
 *        `locale: "fr"` in the context).
 * @returns {{ routes: string[],
 *             match: (pathname: string) => object | null,
 *             load: (m: object, ctx?: object) => Promise<unknown>,
 *             loadSerialized: (m: object, ctx?: object) => Promise<{ data: unknown, json: string }>,
 *             handle: (request: Request) => Promise<Response | null> }}
 */
export function createLoaderRegistry(loaderModules = {}, { appDir, i18n } = {}) {
  const entries = [];
  for (const file in loaderModules) {
    const ns = loaderModules[file];
    const fn = ns.default ?? ns.loader;
    if (typeof fn !== "function") continue; // a loader file without a loader export is inert
    const route = loaderRouteFromPath(file, appDir);
    entries.push({ route, pattern: compilePattern(route), fn, dynamic: route.includes("[") });
  }
  // Static before dynamic, longer before shorter — most specific wins (see api.js).
  entries.sort((a, b) => a.dynamic - b.dynamic || b.route.length - a.route.length);

  const i18nOn = !!(i18n && Array.isArray(i18n.locales) && i18n.locales.length);
  const defaultLocale = i18nOn ? (i18n.defaultLocale ?? i18n.locales[0]) : null;
  const nonDefault = i18nOn ? new Set(i18n.locales.filter((l) => l !== defaultLocale)) : null;

  /** Match a *page* pathname (no `__data.json` suffix) → `{ route, params, locale }` or null. */
  function match(pathname) {
    let path = normalize(pathname);
    let locale = defaultLocale;
    if (nonDefault) {
      const m = path.match(/^\/([^/]+)(\/.*|)$/);
      if (m && nonDefault.has(m[1])) {
        locale = m[1];
        path = m[2] || "/";
      }
    }
    for (const e of entries) {
      const m = path.match(e.pattern);
      if (!m) continue;
      const params = { ...(m.groups || {}) };
      for (const k in params) {
        params[k] = e.route.includes(`[...${k}]`)
          ? params[k].split("/").map(decodeParam)
          : decodeParam(params[k]);
      }
      return { route: e.route, params, locale, fn: e.fn };
    }
    return null;
  }

  /** Run a matched loader. `request` is the live Request under serve/dev and
   *  `undefined` at SSG prerender; `locals` is reserved (middleware is future work). */
  async function load(m, { request, query = {} } = {}) {
    return m.fn({ params: m.params, query, request, locale: m.locale, locals: {} });
  }

  /** {@link load}, plus the serialized form — escaping lives in one place. */
  async function loadSerialized(m, ctx) {
    const data = await load(m, ctx);
    return { data, json: serializeRouteData(data) };
  }

  /**
   * The `<path>/__data.json` HTTP endpoint (docs/DATA.md): a `Response` for any
   * data URL — including 404 on a miss, so the reserved suffix never falls
   * through to SSR — or `null` for every other path.
   */
  async function handle(request) {
    const url = new URL(request.url);
    const pathname = normalize(url.pathname);
    let pagePath = null;
    if (pathname === `/${DATA_FILE}`) pagePath = "/";
    else if (pathname.endsWith(`/${DATA_FILE}`)) {
      pagePath = pathname.slice(0, -(DATA_FILE.length + 1)) || "/";
    }
    if (pagePath === null) return null;

    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const headers = { "content-type": "application/json", "cache-control": "no-store" };
    const m = match(pagePath);
    if (!m) return new Response("null", { status: 404, headers });
    try {
      const { json } = await loadSerialized(m, {
        request,
        query: Object.fromEntries(url.searchParams),
      });
      // `json || "null"` — an undefined loader result still yields valid JSON
      // (the client maps a 404 to undefined; a 200 must parse).
      return new Response(method === "HEAD" ? null : json || "null", { status: 200, headers });
    } catch (e) {
      if (isNotFound(e)) return new Response("null", { status: 404, headers });
      console.error(`✗ loader ${pagePath}:`, e?.stack ?? e);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  return { routes: entries.map((e) => e.route), match, load, loadSerialized, handle };
}
