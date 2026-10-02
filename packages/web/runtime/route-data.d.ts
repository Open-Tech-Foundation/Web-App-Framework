/** The data-endpoint URL for a page path: `"/"` → `/__data.json`,
 *  `"/todos"` → `/todos/__data.json`, preserving the query string. */
export function dataUrlFor(pathname: any, search?: string): string;
/**
 * Fetch a route's loader data. 200 → the parsed JSON; 404 → `undefined` (no
 * loader / `notFound()`); anything else throws (the router reports it and
 * commits the navigation with no data).
 */
export function fetchRouteData(pathname: any, search?: string): Promise<any>;
/** The loader data inlined by the server for the current document, or `undefined`. */
export function readInlineRouteData(): any;
/** Reset the cached inline payload (tests only — a fresh document between cases). */
export function __resetInlineRouteData(): void;
/** The reserved per-route data filename/URL suffix (`/todos` → `/todos/__data.json`). */
export const DATA_FILE: "__data.json";
