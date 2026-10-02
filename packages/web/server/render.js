//! Server render for SSG (ARCHITECTURE.md §6) — composes a route's HTML by
//! calling the SSG render functions the compiler emits (page/layout factories
//! that return strings, components registered in the SSG registry). No DOM: this
//! runs in plain Bun/Node at build time.
//
// The route table (registerRoutes/matchRoute/layoutChain) is shared with the
// client router; here we resolve a route's page + layout chain to string
// renderers and concatenate them, passing `children` as an HTML string.

import {
  layoutChain,
  matchRoute,
  resolveModule,
  routes,
  setRouteState,
} from "../runtime/router.js";
import { resolveMetadata } from "./head.js";
import { beginHydrationCollect, endHydrationCollect } from "./ssg-runtime.js";
import { withRenderContext } from "./render-context.js";

/**
 * Render `pathname` to `{ html, metadata, status, hydration }`: the markup for inside
 * `#app`, the resolved SEO metadata (for the `<head>`), an HTTP `status` (200 when the
 * path matched a real route, 404 when it fell back to the registered 404 page — the SSR
 * server uses it; SSG ignores it), and `hydration` — the JSON island-props payload the
 * toolchain embeds so the client resumes from rich data (`""` when nothing needs it).
 * `params` (from `getStaticPaths`) override the matched route's params for dynamic
 * routes. `options.data` is the route's loader result (run by the caller — serve /
 * prerender own the loader bundle) and is exposed to the page as `router.data`.
 * Returns `null` if there's no match and no 404 page.
 */
export async function renderRoute(pathname, params = null, search = "", { data } = {}) {
  return withRenderContext({ route: {}, hydration: null }, () =>
    renderInContext(pathname, params, search, data));
}

async function renderInContext(pathname, params, search, data) {
  const real = matchRoute(pathname);
  const match =
    real || (routes.notFound ? { entry: routes.notFound, params: {}, route: null } : null);
  if (!match) return null;
  if (params) match.params = params;

  // Let a page reading `router.params`/`pathname`/`query`/`data` resolve to this route.
  setRouteState({ pathname, search, params: match.params, data });

  const query = Object.fromEntries(new URLSearchParams(search));
  const props = { params: match.params, query };

  // Import modules before collecting: module-level JSX must keep its inline
  // props rather than capture hydration ids belonging to just the first request.
  const chain = layoutChain(match.route);
  const [pageModule, ...layoutModules] = await Promise.all(
    [match.entry, ...chain].map(async entry => {
      const module = await resolveModule(entry);
      // A loader can return a bare factory. Keep it distinguishable from a
      // loader when these resolved entries are passed to metadata resolution.
      return typeof module === "function" ? { default: module } : module;
    }),
  );
  const page = pageModule?.default ?? pageModule;
  const layouts = layoutModules.map(module => module?.default ?? module);

  // Each context owns its hydration ids, including when another render is nested.
  let html, hydration;
  beginHydrationCollect();
  try {
    html = page(props);
    // Wrap with layouts, most-specific inward to root outermost.
    for (let i = layouts.length - 1; i >= 0; i--) {
      html = layouts[i]({ ...props, children: html });
    }
  } finally {
    hydration = endHydrationCollect();
  }

  const metadata = await resolveMetadata({
    route: match.route,
    entry: pageModule,
    layouts: layoutModules,
    params: match.params,
    query,
  });
  // `route` is the matched *pattern* ("/docs/[slug]", null for the 404 fallback) — the
  // toolchain keys its per-route chunk manifest by it to emit `<link rel="modulepreload">`.
  return { html, metadata, status: real ? 200 : 404, hydration, route: match.route };
}

/** Back-compat / convenience: render just the `#app` markup for `pathname`. */
export async function renderToString(pathname, search = "") {
  const result = await renderRoute(pathname, null, search);
  return result ? result.html : null;
}

/** Validate a generated URL segment before encoding it for the route. */
function encodedSegment(value, route, key) {
  if ((typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isFinite(value))) {
    throw new Error(`getStaticPaths for ${route}: parameter "${key}" must be a string or finite number.`);
  }
  const text = String(value);
  if (!text || text === "." || text === ".." || /[\\/\x00-\x1f\x7f]/.test(text)) {
    throw new Error(`getStaticPaths for ${route}: invalid segment for "${key}". Use an array for catch-all segments.`);
  }
  try { return encodeURIComponent(text); }
  catch { throw new Error(`getStaticPaths for ${route}: invalid Unicode in "${key}".`); }
}

function fillRoute(route, params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error(`getStaticPaths for ${route}: params must be an object.`);
  }
  return route.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, rest, key) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      throw new Error(`getStaticPaths for ${route}: missing parameter "${key}".`);
    }
    const value = params[key];
    if (rest) {
      const segments = Array.isArray(value) ? value : [value];
      if (!segments.length) throw new Error(`getStaticPaths for ${route}: catch-all "${key}" must not be empty.`);
      return segments.map(segment => encodedSegment(segment, route, key)).join("/");
    }
    return encodedSegment(value, route, key);
  });
}

/**
 * Enumerate the concrete paths to pre-render as `{ path, params, route }`. Static routes
 * are taken as-is (`params: {}`); dynamic routes (`[param]`) are expanded via the
 * page module's optional `getStaticPaths()` (returning `[{ params }]`), carrying the
 * params forward so the renderer/`generateMetadata` see them. `route` is the pattern the
 * concrete path came from, so the caller can look the path up in pattern-keyed build data
 * (the chunk manifest behind `<link rel="modulepreload">`). Dynamic routes without
 * `getStaticPaths` are collected as `skipped`.
 */
export async function collectRoutePaths() {
  const paths = [];
  const skipped = [];
  const seen = new Map();
  function add(path, params, route) {
    const key = new URL(path, "https://otfw.invalid").pathname.replace(/\/+$/, "") || "/";
    if (seen.has(key)) throw new Error(`Duplicate static path "${path}" from ${route}; already generated by ${seen.get(key)}.`);
    seen.set(key, route);
    paths.push({ path, params, route });
  }
  for (const route in routes.pages) {
    if (!route.includes("[")) {
      add(route, {}, route);
      continue;
    }
    const ns = await resolveModule(routes.pages[route]);
    const getStaticPaths =
      ns && (ns.getStaticPaths || (ns.default && ns.default.getStaticPaths));
    if (typeof getStaticPaths === "function") {
      const entries = await getStaticPaths();
      if (!Array.isArray(entries)) throw new Error(`getStaticPaths for ${route} must return an array.`);
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(`getStaticPaths for ${route}: each entry must be a params object or { params }.`);
        }
        if (Object.prototype.hasOwnProperty.call(entry, "props")) {
          throw new Error(`getStaticPaths for ${route}: props are unsupported. Use a route loader and router.data for page data.`);
        }
        const params = Object.prototype.hasOwnProperty.call(entry, "params") ? entry.params : entry;
        add(fillRoute(route, params), params, route);
      }
    } else {
      skipped.push(route);
    }
  }
  return { paths, skipped };
}
