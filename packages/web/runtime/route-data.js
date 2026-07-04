// Route-loader data on the client (docs/DATA.md). A page with a sibling
// `loader.{js,ts}` gets its data three ways, all converging on `router.data`:
//
//   • first paint over server HTML — the payload is inlined as
//     `<script type="application/json" id="__otfw_data">` and read here;
//   • SPA navigation — fetched from `<path>/__data.json` (the same URL a static
//     host serves as a literal file written at SSG time, and the serve/dev
//     servers answer dynamically);
//   • dev/CSR first load — the same fetch, since there is no server markup.
//
// The endpoint returns the raw loader JSON (no envelope): 404 means "no data for
// this route" (no loader, or the loader called `notFound()`) and maps to
// `undefined` so the page renders its empty state.

/** The reserved per-route data filename/URL suffix (`/todos` → `/todos/__data.json`). */
export const DATA_FILE = "__data.json";

// Match the router's path normalization (a trailing slash must hit the same URL).
const normalize = (p) => (p || "/").replace(/(.)\/+$/, "$1");

/** The data-endpoint URL for a page path: `"/"` → `/__data.json`,
 *  `"/todos"` → `/todos/__data.json`, preserving the query string. */
export function dataUrlFor(pathname, search = "") {
  const path = normalize(pathname);
  return (path === "/" ? `/${DATA_FILE}` : `${path}/${DATA_FILE}`) + (search || "");
}

/**
 * Fetch a route's loader data. 200 → the parsed JSON; 404 → `undefined` (no
 * loader / `notFound()`); anything else throws (the router reports it and
 * commits the navigation with no data).
 */
export async function fetchRouteData(pathname, search = "") {
  const res = await fetch(dataUrlFor(pathname, search));
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`route data request for ${pathname} failed (${res.status})`);
  return res.json();
}

// The inline first-paint payload, read once and cached (mirrors the island-props
// payload reader in hydrate.js). `undefined` data serializes to *no script at all*
// (the toolchain skips injection), so a missing element simply reads as undefined.
let _read = false;
let _value;

/** The loader data inlined by the server for the current document, or `undefined`. */
export function readInlineRouteData() {
  if (!_read) {
    _read = true;
    const el = typeof document !== "undefined" ? document.getElementById("__otfw_data") : null;
    try {
      _value = el ? JSON.parse(el.textContent || "null") : undefined;
    } catch {
      _value = undefined;
    }
  }
  return _value;
}

/** Reset the cached inline payload (tests only — a fresh document between cases). */
export function __resetInlineRouteData() {
  _read = false;
  _value = undefined;
}
