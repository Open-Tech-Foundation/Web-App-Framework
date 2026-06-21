//! Server-side render for SSG (build-time pre-render, SPEC §9). Server-only — not
//! imported by the browser bundle.
//
// `renderToString(pathname)` reuses the router's pure matching/assembly
// (`matchRoute` + `buildRouteNode`) to build the page+layout tree in a server DOM
// (linkedom, installed as globals by the prerender harness), then serializes the
// populated light DOM. Custom Elements connect on append (their connectedCallback
// runs the view); the signals core runs each binding once and skips the reactive
// graph while `globalThis.__OTFW_SSG__` is set, so the markup reflects initial
// state without retaining client reactivity.
//
// The harness must set `globalThis.__OTFW_SSG__ = true` and install a
// `window.location` for the route before importing the app (router.js reads it at
// module init).

import { buildRouteNode, matchRoute, routes, setRouteState } from "../runtime/router.js";

/**
 * Render `pathname` to an HTML string (the markup that belongs inside `#app`).
 * Falls back to the registered `404` page for an unmatched path; returns `null`
 * if there's no match and no 404 (caller decides what to emit).
 */
export async function renderToString(pathname, search = "") {
  const match =
    matchRoute(pathname) ||
    (routes.notFound ? { entry: routes.notFound, params: {}, route: null } : null);
  if (!match) return null;

  // Make `router.pathname`/`params`/`query` resolve to the route being rendered.
  setRouteState({ pathname, search, params: match.params });

  const { node, nodes } = await buildRouteNode(match, Object.fromEntries(new URLSearchParams(search)));

  // Append into a connected container so descendant Custom Elements connect (their
  // connectedCallback builds the view). A detached subtree would not upgrade.
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.appendChild(node);
  // Fallback for any element a server DOM didn't auto-connect (SPEC §9.1).
  for (const el of host.querySelectorAll("*")) {
    if (typeof el.connectedCallback === "function" && !el._mounted) el.connectedCallback();
  }

  // Let microtask-deferred DOM swaps settle before serializing — e.g. an
  // <ErrorBoundary> renders its fallback in a microtask after a child throws.
  await new Promise((resolve) => queueMicrotask(resolve));

  const html = host.innerHTML;
  host.remove();
  // `nodes` is returned for symmetry with the client; SSG runs no onMount.
  void nodes;
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
 * `getStaticPaths()` (returning `[{ params }]`), else collected as `skipped` so
 * the caller can warn (those render at runtime on the client).
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
