// File-based client router for the OpenTF Web runtime.
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

import { signal } from "../core/signals.js";
import { mount, runCleanup } from "./mount.js";

const isBrowser = typeof window !== "undefined";

const state = {
  pathname: signal(isBrowser ? window.location.pathname : "/"),
  searchParams: signal(new URLSearchParams(isBrowser ? window.location.search : "")),
  params: signal({}),
};

export const routes = { pages: {}, notFound: null };
let guard = null;
let rootEl = null;
let currentNode = null;

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
    .replace(/\/(page|404)\.(jsx|tsx)$/, "");
  return r === "" ? "/" : r;
}

/**
 * Register pages from a `{ path: entry }` map. Each `entry` is either a module
 * namespace (eager) or a `() => import(...)` loader (lazy, code-split) — both
 * resolve to a default-export factory at navigation time.
 */
export function registerRoutes(modules) {
  for (const file in modules) {
    const entry = modules[file];
    if (/\/404\.(jsx|tsx)$/.test(file)) routes.notFound = entry;
    else routes.pages[routeFromPath(file)] = entry;
  }
}

/** Resolve a route entry (module namespace or lazy loader) to its factory. */
async function resolveFactory(entry) {
  const mod = typeof entry === "function" ? await entry() : entry;
  return mod && mod.default ? mod.default : mod;
}

/** Match `pathname` against the registered routes, resolving `[param]` segments. */
function matchRoute(pathname) {
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
      return { entry: routes.pages[route], params };
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
    (routes.notFound ? { entry: routes.notFound, params: {} } : null);

  state.pathname.value = url.pathname;
  state.searchParams.value = url.searchParams;
  state.params.value = match ? match.params : {};

  if (!isPop) {
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
  }

  // Resolve (and lazily load) the page before tearing down the current view, so
  // a slow/failed import doesn't leave a blank page.
  let factory = null;
  if (match) {
    try {
      factory = await resolveFactory(match.entry);
    } catch (e) {
      console.error("Failed to load route", url.pathname, e);
      rootEl.replaceChildren();
      rootEl.innerHTML = `<pre style="color:#f87171;padding:1rem">Failed to load ${url.pathname}\n${e?.message ?? e}</pre>`;
      currentNode = null;
      return;
    }
  }

  if (currentNode) {
    runCleanup(currentNode);
    currentNode.remove();
  }
  rootEl.replaceChildren();

  if (factory) {
    currentNode = mount(factory, rootEl);
  } else {
    rootEl.innerHTML = "<h1>404 — Not Found</h1>";
    currentNode = null;
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

// `<Link href>` compiles to `<web-link href>`; this Custom Element wraps its
// children in an <a> and intercepts same-origin clicks for SPA navigation.
export class LinkElement extends HTMLElement {
  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    const a = document.createElement("a");
    const href = this.getAttribute("href") || "#";
    a.setAttribute("href", href);
    // The compiler currently emits className as a literal attribute; honor both.
    const cls =
      this.getAttribute("class") || this.getAttribute("className") || "";
    if (cls) a.className = cls;
    while (this.firstChild) a.appendChild(this.firstChild);
    a.addEventListener("click", (e) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      )
        return;
      e.preventDefault();
      navigate(href);
    });
    this.appendChild(a);
  }
}

// Exported so the source-level `import { Link } from "@opentf/web"` resolves; the
// import's side effect registers the element (the JSX uses the `web-link` tag).
export const Link = LinkElement;
if (isBrowser && !customElements.get("web-link")) {
  customElements.define("web-link", LinkElement);
}
