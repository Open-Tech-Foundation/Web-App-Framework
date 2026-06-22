// File-based client router for the OTF Web runtime.
//
// Pages/layouts compile to factory functions (default export) that return a DOM
// node; `mountApp` registers a route table discovered from the filesystem (by the
// dev server / build) and renders the matching page into the app root, swapping
// it on navigation. Route state (pathname/params/query) is exposed reactively via
// the `router` facade so views can read `router.pathname` etc. inside bindings.
//
// Dynamic segments use the `[param]` / `[...rest]` folder convention (SPEC §6).
//
// NOTE: passing route params to a page via its `props` argument
// (`function Page(props) { props.params.id }`) and layout `props.children`
// composition both require signal-free page props, which the compiler does not
// emit yet — for now pages read params via the reactive `router.params`.

import { clearError, reportError } from "../core/errors.js";
import { signal } from "../core/signals.js";
import { runCleanup, runMount } from "./mount.js";

const isBrowser = typeof window !== "undefined";

const state = {
  pathname: signal(isBrowser ? window.location.pathname : "/"),
  searchParams: signal(new URLSearchParams(isBrowser ? window.location.search : "")),
  params: signal({}),
};

export const routes = { pages: {}, layouts: {}, notFound: null };
let guard = null;
let rootEl = null;
let currentNodes = [];

/** Reactive router facade — getters read signal values (tracked in effects). */
export const router = {
  get pathname() {
    return state.pathname.value;
  },
  get searchParams() {
    return state.searchParams.value;
  },
  get query() {
    return Object.fromEntries(state.searchParams.value);
  },
  get params() {
    return state.params.value;
  },
  push: (path) => navigate(path),
  replace: (path) => navigate(path, true),
};

/** Derive the route ("/counter", "/") from a `.../app/<route>/page.jsx` path. */
function routeFromPath(filePath) {
  const r = filePath
    .replace(/^.*\/app/, "")
    .replace(/\/(page|layout|404)\.(jsx|tsx|mdx|md)$/, "");
  return r === "" ? "/" : r;
}

/**
 * Register routes from a `{ path: entry }` map. Each `entry` is either a module
 * namespace (eager) or a `() => import(...)` loader (lazy, code-split) — both
 * resolve to a default-export factory at navigation time. `layout.jsx` files
 * register as layouts (wrapping nested pages), `404.jsx` as the fallback.
 */
export function registerRoutes(modules) {
  for (const file in modules) {
    const entry = modules[file];
    if (/\/404\.(jsx|tsx)$/.test(file)) routes.notFound = entry;
    else if (/\/layout\.(jsx|tsx)$/.test(file)) routes.layouts[routeFromPath(file)] = entry;
    else routes.pages[routeFromPath(file)] = entry;
  }
}

/** Layout entries that wrap `route`, outermost (root) first. */
export function layoutChain(route) {
  const chain = [];
  if (!route) return chain;
  let p = route;
  while (true) {
    if (routes.layouts[p]) chain.unshift(routes.layouts[p]);
    if (p === "/") break;
    p = p.slice(0, p.lastIndexOf("/")) || "/";
  }
  return chain;
}

/** Resolve a route entry (module namespace or lazy loader) to its factory. */
export async function resolveFactory(entry) {
  const mod = typeof entry === "function" ? await entry() : entry;
  return mod && mod.default ? mod.default : mod;
}

/**
 * Build the DOM node for a matched route: the page factory wrapped by its layout
 * chain (most-specific inward, root outermost). Returns the outermost `node` plus
 * the ordered `nodes` list (page → … → root) so callers can run lifecycle on each.
 * Shared by the client router (`navigate`) and server render (`renderToString`).
 */
export async function buildRouteNode(match, query = {}) {
  const props = { params: match.params, query };
  const pageFactory = await resolveFactory(match.entry);
  let node = pageFactory(props);
  const nodes = [node];
  const chain = layoutChain(match.route);
  for (let i = chain.length - 1; i >= 0; i--) {
    const layout = await resolveFactory(chain[i]);
    node = layout({ ...props, children: node });
    nodes.push(node);
  }
  return { node, nodes };
}

/**
 * Set the reactive route state directly (no history/render). Used by server render
 * so a page reading `router.pathname`/`params`/`query` resolves to the route being
 * pre-rendered. The client uses `navigate` instead.
 */
export function setRouteState({ pathname = "/", search = "", params = {} } = {}) {
  state.pathname.value = pathname;
  state.searchParams.value = new URLSearchParams(search);
  state.params.value = params;
}

/** Match `pathname` against the registered routes, resolving `[param]` segments. */
export function matchRoute(pathname) {
  for (const route in routes.pages) {
    const pattern = route
      .replace(/\[\.\.\.([^\]]+)\]/g, "(?<$1>.+)")
      .replace(/\[([^\]]+)\]/g, "(?<$1>[^/]+)");
    const m = pathname.match(new RegExp(`^${pattern}/?$`));
    if (m) {
      const params = { ...(m.groups || {}) };
      for (const k in params) {
        if (route.includes(`[...${k}]`)) params[k] = params[k].split("/");
      }
      return { entry: routes.pages[route], params, route };
    }
  }
  return null;
}

/**
 * Navigate to `path`. Runs an optional route guard, swaps the rendered page
 * (tearing down the previous one's lifecycle), and updates window.history.
 */
export async function navigate(path, replace = false, isPop = false) {
  if (!path || !rootEl) return;
  const url = new URL(path, window.location.origin);

  if (guard) {
    let redirected = false;
    const to = {
      path: url.pathname,
      params: matchRoute(url.pathname)?.params || {},
      query: Object.fromEntries(url.searchParams),
    };
    await new Promise((resolve) => {
      const tools = {
        next: () => resolve(),
        redirect: (p) => {
          redirected = true;
          navigate(p, true);
          resolve();
        },
        replace: (p) => {
          redirected = true;
          navigate(p, true);
          resolve();
        },
      };
      Promise.resolve(guard(to, tools)).catch(() => resolve());
    });
    if (redirected) return;
  }

  const match =
    matchRoute(url.pathname) ||
    (routes.notFound ? { entry: routes.notFound, params: {}, route: null } : null);

  state.pathname.value = url.pathname;
  state.searchParams.value = url.searchParams;
  state.params.value = match ? match.params : {};

  if (!isPop) {
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
  }

  // Resolve (and lazily load) the page + its layout chain before tearing down the
  // current view, so a slow/failed import doesn't leave a blank page.
  let nodes = null;
  if (match) {
    try {
      const built = await buildRouteNode(match, Object.fromEntries(url.searchParams));
      nodes = built.nodes;
    } catch (e) {
      reportError(e, { phase: "route", path: url.pathname });
      rootEl.replaceChildren();
      rootEl.innerHTML = `<pre style="color:#f87171;padding:1rem">Failed to load ${url.pathname}\n${e?.message ?? e}</pre>`;
      currentNodes = [];
      return;
    }
  }

  for (const n of currentNodes) runCleanup(n);
  rootEl.replaceChildren();

  if (nodes) {
    rootEl.appendChild(nodes[nodes.length - 1]); // outermost node
    for (const n of nodes) runMount(n); // run onMount for page + every layout
    currentNodes = nodes;
    clearError({ phase: "route" }); // a good render dismisses a prior error overlay
  } else {
    rootEl.innerHTML = "<h1>404 — Not Found</h1>";
    currentNodes = [];
  }
}

/**
 * Bootstrap the application: register routes, wire history, and render the page
 * for the current URL.
 *
 * @param {Object} opts
 * @param {Object} opts.pages  `{ path: module }` route map (from the dev server).
 * @param {Element} [opts.target]  the app root (defaults to `#app`).
 * @param {Function} [opts.guard]  optional `(to, tools) => …` route guard.
 */
export function mountApp({ pages, target, guard: g } = {}) {
  rootEl = target || (isBrowser ? document.getElementById("app") : null);
  if (pages) registerRoutes(pages);
  guard = g || null;
  if (isBrowser) {
    window.addEventListener("popstate", () =>
      navigate(
        window.location.pathname + window.location.search + window.location.hash,
        false,
        true,
      ),
    );
  }
  navigate(window.location.pathname + window.location.search + window.location.hash, true, true);
}

// `<Link>` is a pure JSX component (packages/web/components/Link.jsx), compiled by
// the app's pipeline like any UI component — it lives there, not as a hand-written
// Custom Element here. It imports `navigate` from this module.
