/** Whether the client router should intercept link clicks (SPA) vs. let the browser
 *  do a full navigation (MPA). Read by `<Link>`. */
export function shouldInterceptNav(): boolean;
/** Register the app's locales (called by `mountApp({ i18n })`). */
export function configureI18n(cfg: any): void;
/** The configured locales + default, or null when i18n isn't enabled. */
export function i18nLocales(): any;
/**
 * Split a leading non-default locale segment off `pathname`, returning the active
 * `locale` and the locale-agnostic `path` to match against the route table. When
 * i18n is off, or the first segment isn't a configured non-default locale, the
 * path passes through unchanged with the default (or null) locale.
 */
export function resolveLocale(pathname: any): {
    locale: any;
    path: any;
};
/**
 * Prefix `path` with `locale` (bare for the default locale). Any locale already on
 * `path` is replaced. Used by `<Link>` and programmatic navigation to keep links
 * in the active locale. Pass-through when i18n is off.
 */
export function localizePath(path: any, locale?: any): any;
/**
 * Set the active locale directly, without navigating. The reactive `router.locale`
 * updates and any `t()`/formatter bindings re-render fine-grained. Intended for
 * previews, tests, and programmatic control — in a routed app the locale is derived
 * from the URL prefix (docs/I18N.md §2), so navigation is the normal path.
 */
export function setLocale(locale: any): void;
/**
 * Register routes from a `{ path: entry }` map. Each `entry` is either a module
 * namespace (eager) or a `() => import(...)` loader (lazy, code-split) — both
 * resolve to a default-export factory at navigation time. `layout.jsx` files
 * register as layouts (wrapping nested pages), `404.jsx` as the fallback.
 */
export function registerRoutes(modules: any): void;
/**
 * Register which route *patterns* (`"/todos"`, `"/items/[id]"`) have a server
 * loader (docs/DATA.md) — the toolchain discovers `loader.{js,ts}` files and
 * passes the list via `mountApp({ loaders })`. `navigate` only fetches
 * `<path>/__data.json` for routes in this set; `matchRoute` returns the same
 * pattern string, so membership is a plain Set lookup.
 */
export function registerLoaderRoutes(paths: any): void;
/** Set the reactive `router.data` directly (server render and tests). */
export function setRouteData(data: any): void;
/** Layout entries that wrap `route`, outermost (root) first. */
export function layoutChain(route: any): any[];
/** Resolve a route entry (module namespace or lazy loader) to its factory. */
export function resolveFactory(entry: any): Promise<any>;
/**
 * Build the DOM node for a matched route: the page factory wrapped by its layout
 * chain (most-specific inward, root outermost). Returns the outermost `node` plus
 * the ordered `nodes` list (page → … → root) so callers can run lifecycle on each.
 * Each factory owns a reactive scope, disposed with its node on navigation.
 */
export function buildRouteNode(match: any, query?: {}): Promise<{
    node: any;
    nodes: any[];
    modules: any[];
}>;
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
export function hydrateRouteNode(match: any, query: any, rootEl: any): Promise<{
    nodes: any[];
} | null>;
/** Resolve a route entry (lazy loader or module namespace) to its module. */
export function resolveModule(entry: any): Promise<any>;
/**
 * Set the reactive route state directly (no history/render). Used by server render
 * so a page reading `router.pathname`/`params`/`query` resolves to the route being
 * pre-rendered. The client uses `navigate` instead.
 */
export function setRouteState({ pathname, search, params, locale, data }?: {
    locale?: string | null;
    data?: unknown;
    pathname?: string | undefined;
    search?: string | undefined;
    params?: {} | undefined;
}): void;
/**
 * Match `pathname` against the registered routes, resolving `[param]` segments. A
 * leading non-default locale segment is stripped first (the route table is
 * locale-agnostic; see `resolveLocale`).
 */
export function matchRoute(pathname: any): {
    entry: any;
    params: any;
    route: string;
} | null;
/**
 * Navigate to `path`. Runs an optional route guard, fetches the route's loader
 * data when it has any (docs/DATA.md — fetch *then* commit, like the guard),
 * swaps the rendered page (tearing down the previous one's lifecycle), and
 * updates window.history.
 */
export function navigate(path: any, replace?: boolean, isPop?: boolean, hydrate?: boolean): Promise<void>;
export function refreshHotRoute(factory: any): Promise<void>;
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
export function mountApp({ pages, target, guard: g, i18n, nav, loaders }?: {
    i18n?: { locales: string[]; defaultLocale?: string };
    pages: Object;
    target?: Element | undefined;
    guard?: Function | undefined;
    nav?: "spa" | "mpa" | undefined;
    loaders?: string[] | undefined;
}): Promise<void>;
export namespace routes {
    let pages: {};
    let layouts: {};
    let notFound: null;
    let loaderRoutes: Set<any>;
}
export namespace router {
    const pathname: any;
    const searchParams: any;
    const query: {
        [k: string]: any;
    };
    const params: any;
    const locale: any;
    const data: any;
    function push(path: any): Promise<void>;
    function replace(path: any): Promise<void>;
}
