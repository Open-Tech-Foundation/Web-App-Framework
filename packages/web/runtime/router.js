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
// emit yet — for now pages read params via the reactive `router.params`, and a
// route loader's data via the reactive `router.data` (docs/DATA.md).

import { clearError, reportError } from "../core/errors.js";
import { signal } from "../core/signals.js";
import { beginHydration, cursor, endHydration } from "./hydrate.js";
import { runCleanup, runMount } from "./mount.js";
import { fetchRouteData, readInlineRouteData } from "./route-data.js";

const isBrowser = typeof window !== "undefined";

/**
 * Drop a trailing slash (except for the root "/") so `router.pathname` matches the
 * no-trailing-slash route table and nav paths regardless of how the URL was entered —
 * a static host serves `/docs/x/`, a Pagefind result links to `/docs/x/`, etc. Without
 * this, `/docs/x/` wouldn't match the `/docs/x` nav entry and the breadcrumb / active
 * sidebar link / TOC would silently blank out.
 */
const normalizePath = (p) => (p || "/").replace(/(.)\/+$/, "$1");

const state = {
  pathname: signal(isBrowser ? normalizePath(window.location.pathname) : "/"),
  searchParams: signal(new URLSearchParams(isBrowser ? window.location.search : "")),
  params: signal({}),
  locale: signal(null),
  data: signal(undefined),
};

export const routes = { pages: {}, layouts: {}, notFound: null, loaderRoutes: new Set() };
let guard = null;
let rootEl = null;

// Navigation mode (docs/HYDRATION.md §7): "spa" (default) lets the client router
// intercept same-origin `<Link>` clicks for reload-free nav; "mpa" leaves every
// navigation to the browser (full page load), with each page hydrating its own first
// paint. MPA is always the substrate — this only toggles the SPA enhancement on top.
let navMode = "spa";

/** Whether the client router should intercept link clicks (SPA) vs. let the browser
 *  do a full navigation (MPA). Read by `<Link>`. */
export function shouldInterceptNav() {
  return navMode === "spa";
}

// i18n: path-prefix locale routing (docs/I18N.md). The route table stays
// locale-agnostic; a leading non-default locale segment is stripped before
// matching and recorded as `router.locale`. `prefix_except_default`: the default
// locale is served at the bare path, others are prefixed (`/fr/about`).
let i18nConfig = null;

/** Register the app's locales (called by `mountApp({ i18n })`). */
export function configureI18n(cfg) {
  if (!cfg || !Array.isArray(cfg.locales) || cfg.locales.length === 0) {
    i18nConfig = null;
    return;
  }
  const defaultLocale = cfg.defaultLocale ?? cfg.locales[0];
  i18nConfig = {
    locales: cfg.locales,
    defaultLocale,
    nonDefault: new Set(cfg.locales.filter((l) => l !== defaultLocale)),
  };
  state.locale.value = defaultLocale;
}

/** The configured locales + default, or null when i18n isn't enabled. */
export function i18nLocales() {
  return i18nConfig && { locales: i18nConfig.locales, defaultLocale: i18nConfig.defaultLocale };
}

/**
 * Split a leading non-default locale segment off `pathname`, returning the active
 * `locale` and the locale-agnostic `path` to match against the route table. When
 * i18n is off, or the first segment isn't a configured non-default locale, the
 * path passes through unchanged with the default (or null) locale.
 */
export function resolveLocale(pathname) {
  const def = i18nConfig ? i18nConfig.defaultLocale : null;
  if (!i18nConfig) return { locale: def, path: pathname };
  const m = (pathname || "/").match(/^\/([^/]+)(\/.*|)$/);
  if (m && i18nConfig.nonDefault.has(m[1])) return { locale: m[1], path: m[2] || "/" };
  return { locale: def, path: pathname };
}

/**
 * Prefix `path` with `locale` (bare for the default locale). Any locale already on
 * `path` is replaced. Used by `<Link>` and programmatic navigation to keep links
 * in the active locale. Pass-through when i18n is off.
 */
export function localizePath(path, locale = state.locale.value) {
  if (!i18nConfig) return path;
  // Strip ANY existing locale prefix (default included, unlike `resolveLocale`
  // which keeps the canonical default bare) so a link can be re-pointed cleanly.
  const m = (path || "/").match(/^\/([^/]+)(\/.*|)$/);
  const bare = m && i18nConfig.locales.includes(m[1]) ? m[2] || "/" : path;
  if (!locale || locale === i18nConfig.defaultLocale) return bare;
  return bare === "/" ? `/${locale}` : `/${locale}${bare}`;
}

/**
 * Set the active locale directly, without navigating. The reactive `router.locale`
 * updates and any `t()`/formatter bindings re-render fine-grained. Intended for
 * previews, tests, and programmatic control — in a routed app the locale is derived
 * from the URL prefix (docs/I18N.md §2), so navigation is the normal path.
 */
export function setLocale(locale) {
  state.locale.value = locale;
}
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
  get locale() {
    return state.locale.value;
  },
  get data() {
    return state.data.value;
  },
  push: (path) => navigate(path),
  replace: (path) => navigate(path, true),
};

/** Derive the route ("/counter", "/") from a `.../app/<route>/page.jsx` path. The
 *  lookahead pins `/app` to a complete path segment, so a route folder that merely
 *  starts with "app" (`/appointments`) isn't clipped. */
function routeFromPath(filePath) {
  const r = filePath
    .replace(/^.*\/app(?=\/)/, "")
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

/**
 * Register which route *patterns* (`"/todos"`, `"/items/[id]"`) have a server
 * loader (docs/DATA.md) — the toolchain discovers `loader.{js,ts}` files and
 * passes the list via `mountApp({ loaders })`. `navigate` only fetches
 * `<path>/__data.json` for routes in this set; `matchRoute` returns the same
 * pattern string, so membership is a plain Set lookup.
 */
export function registerLoaderRoutes(paths) {
  routes.loaderRoutes = new Set(paths || []);
}

/** Set the reactive `router.data` directly (server render and tests). */
export function setRouteData(data) {
  state.data.value = data;
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
 * Adopt a matched route's server-rendered DOM (docs/HYDRATION.md §3.4, 2.1c) — the hydrate
 * analogue of {@link buildRouteNode}. One cursor threads the whole layout chain: the
 * outermost layout adopts at the container, and each layout hands that cursor to the next at
 * its `{children}` slot (`props.children` is a thunk that claims the nested route's subtree
 * and advances the cursor), down to the page. Returns `{ nodes }` (page → … → root) for
 * lifecycle, or `null` if the page or any layout isn't adoptable (no `hydrateAt` export) — the
 * caller then falls back to a clean CSR build. A thrown `HydrationMismatch` propagates up,
 * disposing each layer's partial wiring on the way (each `hydrateAt` has its own guard).
 */
export async function hydrateRouteNode(match, query, rootEl) {
  const props = { params: match.params, query };
  const pageMod = await resolveModule(match.entry);
  if (!pageMod || typeof pageMod.hydrateAt !== "function") return null;
  const chain = layoutChain(match.route);
  const layoutMods = [];
  for (const entry of chain) {
    const m = await resolveModule(entry);
    if (!m || typeof m.hydrateAt !== "function") return null; // whole chain must be adoptable
    layoutMods.push(m);
  }

  // Compose the adopt thunks innermost-first: the page, then each layout wrapping it. Each
  // thunk pushes its claimed root node, so `nodes` ends up page → … → outermost (the inner
  // thunk runs — and pushes — during the outer layout's walk, before the outer pushes).
  const nodes = [];
  let thunk = (c) => {
    const n = pageMod.hydrateAt(c, props);
    nodes.push(n);
    return n;
  };
  for (let i = chain.length - 1; i >= 0; i--) {
    const layout = layoutMods[i];
    const inner = thunk;
    thunk = (c) => {
      const n = layout.hydrateAt(c, { ...props, children: inner });
      nodes.push(n);
      return n;
    };
  }
  thunk(cursor(rootEl)); // outermost adopts at the container; the chain threads inward
  return { nodes };
}

/** Resolve a route entry (lazy loader or module namespace) to its module. */
async function resolveModule(entry) {
  return typeof entry === "function" ? await entry() : entry;
}

/**
 * Set the reactive route state directly (no history/render). Used by server render
 * so a page reading `router.pathname`/`params`/`query` resolves to the route being
 * pre-rendered. The client uses `navigate` instead.
 */
export function setRouteState({ pathname = "/", search = "", params = {}, locale, data } = {}) {
  state.pathname.value = normalizePath(pathname);
  state.searchParams.value = new URLSearchParams(search);
  state.params.value = params;
  state.locale.value = locale !== undefined ? locale : resolveLocale(pathname).locale;
  // Always assigned (even when the caller passed none) so a loader-less render
  // never shows a previous route's stale data.
  state.data.value = data;
}

/**
 * Match `pathname` against the registered routes, resolving `[param]` segments. A
 * leading non-default locale segment is stripped first (the route table is
 * locale-agnostic; see `resolveLocale`).
 */
export function matchRoute(pathname) {
  pathname = resolveLocale(pathname).path;
  for (const route in routes.pages) {
    // `[param]` / `[...rest]` become named groups; literal parts are regex-escaped
    // (a `v1.0` folder must not match `v1X0`).
    const pattern = route
      .split(/(\[\.\.\.[^\]]+\]|\[[^\]]+\])/)
      .map((part) => {
        if (part.startsWith("[...")) return `(?<${part.slice(4, -1)}>.+)`;
        if (part.startsWith("[")) return `(?<${part.slice(1, -1)}>[^/]+)`;
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
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

// Monotonic navigation sequence: a navigation that awaited its loader-data fetch
// commits only if no newer navigation started meanwhile (stale data must never
// win over a later click).
let navSeq = 0;

// --- Stale-chunk recovery ---------------------------------------------------
// Pages/layouts are code-split, so a route is loaded by a lazy `() => import(...)`
// at navigation time. Asset filenames are content-hashed (`layout-DmM9YRKj.js`),
// so a new deploy replaces them: a tab that loaded the OLD `index.html` still holds
// the old chunk names, and the moment the user navigates to a not-yet-loaded route
// its `import()` 404s — "Failed to fetch dynamically imported module".
//
// Recovery is a single full page load, which fetches the fresh `index.html` (new
// hashes) and completes the navigation for real. We don't try to distinguish a
// redeploy from a transient network error first — a HEAD probe of the chunk isn't
// reliable across hosts (405 / no-HEAD, S3 returning 403 for missing keys, CORS
// preflight, CDN quirks). The reload is guarded by a one-time, tab-scoped
// sessionStorage flag that survives the reload, so a genuinely broken deploy (fresh
// HTML still 404s) reloads once and then surfaces the error instead of looping.

/**
 * Whether `e` is a failed dynamic `import()` of a code-split route chunk — the
 * signature of the stale-chunk-after-redeploy problem. The message differs per
 * engine, so match all three:
 *   Chrome/Edge: "Failed to fetch dynamically imported module: <url>"
 *   Firefox:     "error loading dynamically imported module: <url>"
 *   Safari:      "Importing a module script failed."
 */
function isChunkLoadError(e) {
  const msg = (e && (e.message || String(e))) || "";
  return /dynamically imported module|Importing a module script failed/i.test(msg);
}

// One-time reload guard. sessionStorage survives `location.reload()` and is scoped to
// this tab (auto-cleared when it closes), so it's the right place to remember "I've
// already tried reloading for this." A genuinely broken deploy — fresh HTML that still
// references a 404ing chunk — therefore reloads exactly once, then surfaces the error
// instead of looping. `clearChunkReloadFlag` drops it on the next successful render, so
// a *later* redeploy can recover in turn.
const CHUNK_RELOAD_FLAG = "otfw:chunk-reloaded";

/**
 * Hard-reload once to pick up fresh HTML + asset hashes, guarded so it can't loop.
 * Returns `false` when a reload was already attempted (the caller should surface the
 * error instead of reloading again).
 */
function reloadForFreshAssets() {
  if (!isBrowser) return false;
  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return false; // already tried once
    window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
  } catch {
    // sessionStorage unavailable — reload unguarded; a normal redeploy still recovers,
    // and the rare broken-deploy loop is the only thing we can't defend against here.
  }
  window.location.reload();
  return true;
}

/** Drop the one-time reload guard once a navigation renders successfully. */
function clearChunkReloadFlag() {
  if (!isBrowser) return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    // ignore
  }
}

/**
 * Navigate to `path`. Runs an optional route guard, fetches the route's loader
 * data when it has any (docs/DATA.md — fetch *then* commit, like the guard),
 * swaps the rendered page (tearing down the previous one's lifecycle), and
 * updates window.history.
 */
export async function navigate(path, replace = false, isPop = false, hydrate = false) {
  if (!path || !rootEl) return;
  const seq = ++navSeq;
  const url = new URL(path, window.location.origin);

  if (guard) {
    let redirected = false;
    const to = {
      // `pathname` is the documented, platform-standard field (matches the URL API
      // and `router.pathname`); `path` is kept as a back-compat alias. `fullPath`
      // is the whole relative URL (pathname + query + hash), for guards that need to
      // preserve or inspect the query/hash (e.g. redirect back after login).
      pathname: url.pathname,
      path: url.pathname,
      fullPath: url.pathname + url.search + url.hash,
      params: matchRoute(url.pathname)?.params || {},
      query: Object.fromEntries(url.searchParams),
    };
    await new Promise((resolve) => {
      // A guard redirect on **first paint** leaves hydration: the server DOM in `#app`
      // belongs to the route we're leaving, so the target route has to build fresh. The
      // hydration flag is seeded `true` from the server sentinel at module load, and this
      // path returns before the `hydrate && match` block that clears it in its `finally` —
      // so without this the flag stayed true for the rest of the session. Every island the
      // redirected build creates would then see `isHydrating() && this.firstChild` and take
      // the *adopt* arm against DOM its own parent had just `createElement`'d, mismatching
      // (`expected a region start marker, found <div>`) and rebuilding — and so would every
      // later SPA navigation. Clear it before the target navigation builds anything.
      const leaveHydration = () => {
        if (hydrate) endHydration();
      };
      const tools = {
        next: () => resolve(),
        redirect: (p) => {
          redirected = true;
          leaveHydration();
          navigate(p, true);
          resolve();
        },
        replace: (p) => {
          redirected = true;
          leaveHydration();
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

  // Loader data (docs/DATA.md): resolved before any state write / history push /
  // DOM swap, mirroring the guard's "settle before commit" flow. First paint over
  // server HTML reads the inlined payload; every other navigation (SPA nav, dev/CSR
  // first load, popstate) fetches the `<path>/__data.json` endpoint. A failed fetch
  // is reported and the navigation commits with `data === undefined`.
  let data;
  if (match && match.route && routes.loaderRoutes.has(match.route)) {
    if (hydrate) {
      data = readInlineRouteData();
    } else {
      try {
        data = await fetchRouteData(url.pathname, url.search);
      } catch (e) {
        reportError(e, { phase: "data", path: url.pathname });
      }
      if (seq !== navSeq) return; // a newer navigation superseded this one
    }
  }

  state.pathname.value = normalizePath(url.pathname);
  state.searchParams.value = url.searchParams;
  state.params.value = match ? match.params : {};
  state.locale.value = resolveLocale(url.pathname).locale;
  state.data.value = data;

  if (!isPop) {
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
  }

  // First paint over server-rendered DOM: *adopt* it (hydrate) instead of rebuilding,
  // when the route module exposes a `hydrateAt` adopt factory (compiled with the hydrate
  // target). `hydrateRouteNode` threads one cursor through the whole layout chain (2.1c);
  // a route whose page or any layout isn't adoptable returns null → clean CSR build. A
  // hydration mismatch is reported (never silent) and also falls through to a rebuild.
  //
  // The hydration flag must be live *before* the route modules are imported: route chunks
  // are code-split, so `customElements.define` — and the synchronous upgrade of every
  // server-rendered `<web-*>` host — happens during those imports, before the factories
  // run. Those upgrading components read `isHydrating()` to adopt their server DOM rather
  // than build (docs/HYDRATION.md §3.4). `endHydration()` in `finally` makes every
  // subsequent client navigation build fresh; the CSR fallback below then runs with the
  // flag cleared, so a rebuilt host builds instead of trying to re-adopt.
  if (hydrate && match) {
    beginHydration();
    try {
      const query = Object.fromEntries(url.searchParams);
      const adopted = await hydrateRouteNode(match, query, rootEl);
      if (adopted) {
        currentNodes = adopted.nodes;
        for (const n of adopted.nodes) runMount(n); // onMount for page + every layout
        clearError({ phase: "route" });
        clearChunkReloadFlag();
        return;
      }
    } catch (e) {
      reportError(e, { phase: "hydrate", path: url.pathname });
      // fall through to a clean CSR build below
    } finally {
      endHydration();
    }
  }

  // Resolve (and lazily load) the page + its layout chain before tearing down the
  // current view, so a slow/failed import doesn't leave a blank page.
  let nodes = null;
  if (match) {
    try {
      const built = await buildRouteNode(match, Object.fromEntries(url.searchParams));
      nodes = built.nodes;
    } catch (e) {
      // A failed route-chunk import (stale after a redeploy, or the network dropped):
      // try one guarded full reload for fresh HTML + hashes. If we already reloaded once
      // and it still fails, fall through to the error overlay instead of looping.
      if (isChunkLoadError(e) && reloadForFreshAssets()) return;
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
    clearChunkReloadFlag(); // a successful render means the reload (if any) recovered
    // A forward navigation lands at the top of the new page (or at the targeted
    // anchor); back/forward (`isPop`) keeps the browser's restored scroll position.
    if (!isPop && isBrowser) {
      const anchor = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
      if (anchor) anchor.scrollIntoView();
      else window.scrollTo(0, 0);
    }
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
 * @param {"spa"|"mpa"} [opts.nav]  navigation mode (default "spa"); "mpa" disables
 *   client-side link interception so every navigation is a full page load.
 * @param {string[]} [opts.loaders]  route patterns that have a server loader
 *   (docs/DATA.md) — navigation fetches `<path>/__data.json` for these.
 */
export function mountApp({ pages, target, guard: g, i18n, nav, loaders } = {}) {
  rootEl = target || (isBrowser ? document.getElementById("app") : null);
  navMode = nav === "mpa" ? "mpa" : "spa";
  if (i18n) configureI18n(i18n);
  if (pages) registerRoutes(pages);
  if (loaders) registerLoaderRoutes(loaders);
  guard = g || null;
  // In MPA mode the browser owns navigation (full loads push real history entries),
  // so there is no client-side history to react to — only wire popstate for SPA.
  if (isBrowser && navMode === "spa") {
    window.addEventListener("popstate", () =>
      navigate(
        window.location.pathname + window.location.search + window.location.hash,
        false,
        true,
      ),
    );
  }
  // Hydrate the first paint when the server stamped `data-otfw-hydrate` on the root and
  // left rendered markup in it; otherwise this is a plain CSR mount (build into #app).
  const hydrate = !!(
    isBrowser &&
    rootEl &&
    rootEl.firstChild &&
    typeof rootEl.hasAttribute === "function" &&
    rootEl.hasAttribute("data-otfw-hydrate")
  );
  // The flag is seeded `true` from the sentinel at module load (so eagerly-defined
  // framework components adopt on upgrade — see hydrate.js). If this mount is NOT
  // hydrating after all (no sentinel, or an empty root), clear it now so the CSR build
  // below — and every later navigation — builds fresh. The hydrate path clears it itself
  // (via `endHydration` in `navigate`'s `finally`) once first paint is adopted.
  if (!hydrate) endHydration();
  return navigate(
    window.location.pathname + window.location.search + window.location.hash,
    true,
    true,
    hydrate,
  );
}

// `<Link>` is a pure JSX component (packages/web/components/Link.jsx), compiled by
// the app's pipeline like any UI component — it lives there, not as a hand-written
// Custom Element here. It imports `navigate` from this module.
