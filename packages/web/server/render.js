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

/**
 * Render `pathname` to an HTML string (the markup for inside `#app`). Falls back
 * to the registered `404` page for an unmatched path; returns `null` if there's
 * no match and no 404.
 */
export async function renderToString(pathname, search = "") {
  const match =
    matchRoute(pathname) ||
    (routes.notFound ? { entry: routes.notFound, params: {}, route: null } : null);
  if (!match) return null;

  // Let a page reading `router.params`/`pathname`/`query` resolve to this route.
  setRouteState({ pathname, search, params: match.params });

  const props = { params: match.params, query: Object.fromEntries(new URLSearchParams(search)) };
  let html = (await resolveFactory(match.entry))(props);

  // Wrap with layouts, most-specific inward to root outermost.
  const chain = layoutChain(match.route);
  for (let i = chain.length - 1; i >= 0; i--) {
    const layout = await resolveFactory(chain[i]);
    html = layout({ ...props, children: html });
  }
  return html;
}

/** Substitute `[param]` / `[...rest]` in a route with concrete values. */
function fillRoute(route, params) {
  return route
    .replace(/\[\.\.\.([^\]]+)\]/g, (_, k) => [].concat(params[k] ?? []).join("/"))
    .replace(/\[([^\]]+)\]/g, (_, k) => String(params[k] ?? ""));
}

/**
 * Enumerate the concrete paths to pre-render. Static routes are taken as-is;
 * dynamic routes (`[param]`) are expanded via the page module's optional
 * `getStaticPaths()` (returning `[{ params }]`), else collected as `skipped`.
 */
export async function collectRoutePaths() {
  const paths = [];
  const skipped = [];
  for (const route in routes.pages) {
    if (!route.includes("[")) {
      paths.push(route);
      continue;
    }
    const ns = routes.pages[route];
    const getStaticPaths =
      ns && (ns.getStaticPaths || (ns.default && ns.default.getStaticPaths));
    if (typeof getStaticPaths === "function") {
      for (const entry of (await getStaticPaths()) || []) {
        paths.push(fillRoute(route, entry.params || entry));
      }
    } else {
      skipped.push(route);
    }
  }
  return { paths, skipped };
}
