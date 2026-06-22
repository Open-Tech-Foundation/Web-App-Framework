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
  resolveFactory,
  routes,
  setRouteState,
} from "../runtime/router.js";
import { resolveMetadata } from "./head.js";

/**
 * Render `pathname` to `{ html, metadata }`: the markup for inside `#app` plus the
 * resolved SEO metadata (for the `<head>`). `params` (from `getStaticPaths`) override
 * the matched route's params for dynamic routes. Falls back to the registered `404`
 * page for an unmatched path; returns `null` if there's no match and no 404.
 */
export async function renderRoute(pathname, params = null, search = "") {
  const match =
    matchRoute(pathname) ||
    (routes.notFound ? { entry: routes.notFound, params: {}, route: null } : null);
  if (!match) return null;
  if (params) match.params = params;

  // Let a page reading `router.params`/`pathname`/`query` resolve to this route.
  setRouteState({ pathname, search, params: match.params });

  const query = Object.fromEntries(new URLSearchParams(search));
  const props = { params: match.params, query };
  let html = (await resolveFactory(match.entry))(props);

  // Wrap with layouts, most-specific inward to root outermost.
  const chain = layoutChain(match.route);
  for (let i = chain.length - 1; i >= 0; i--) {
    const layout = await resolveFactory(chain[i]);
    html = layout({ ...props, children: html });
  }

  const metadata = await resolveMetadata({
    route: match.route,
    entry: match.entry,
    params: match.params,
    query,
  });
  return { html, metadata };
}

/** Back-compat / convenience: render just the `#app` markup for `pathname`. */
export async function renderToString(pathname, search = "") {
  const result = await renderRoute(pathname, null, search);
  return result ? result.html : null;
}

/** Substitute `[param]` / `[...rest]` in a route with concrete values. */
function fillRoute(route, params) {
  return route
    .replace(/\[\.\.\.([^\]]+)\]/g, (_, k) => [].concat(params[k] ?? []).join("/"))
    .replace(/\[([^\]]+)\]/g, (_, k) => String(params[k] ?? ""));
}

/**
 * Enumerate the concrete paths to pre-render as `{ path, params }`. Static routes
 * are taken as-is (`params: {}`); dynamic routes (`[param]`) are expanded via the
 * page module's optional `getStaticPaths()` (returning `[{ params }]`), carrying the
 * params forward so the renderer/`generateMetadata` see them. Dynamic routes without
 * `getStaticPaths` are collected as `skipped`.
 */
export async function collectRoutePaths() {
  const paths = [];
  const skipped = [];
  for (const route in routes.pages) {
    if (!route.includes("[")) {
      paths.push({ path: route, params: {} });
      continue;
    }
    const ns = routes.pages[route];
    const getStaticPaths =
      ns && (ns.getStaticPaths || (ns.default && ns.default.getStaticPaths));
    if (typeof getStaticPaths === "function") {
      for (const entry of (await getStaticPaths()) || []) {
        const params = entry.params || entry;
        paths.push({ path: fillRoute(route, params), params });
      }
    } else {
      skipped.push(route);
    }
  }
  return { paths, skipped };
}
