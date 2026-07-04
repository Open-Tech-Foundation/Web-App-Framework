// Type definitions for file-based API routes (SPEC §11). Authoring handlers in
// TypeScript: annotate the method exports with `ApiHandler` and the `_middleware`
// default export with `Middleware`.
//
//   import type { ApiHandler, Middleware } from "@opentf/web/server";
//   export const GET: ApiHandler = (request, { params }) => Response.json({ id: params.id });

type MaybePromise<T> = T | Promise<T>;

/**
 * Route params resolved from `[param]` / `[...rest]` segments. A `[param]` segment
 * resolves to a `string`; a `[...rest]` catch-all resolves to a `string[]`.
 */
export type RouteParams = Record<string, string | string[]>;

/** Per-request context, passed as the second argument to handlers and middleware. */
export interface ApiContext {
  /** Dynamic route params resolved from the matched path. */
  params: RouteParams;
  /** Parsed query-string parameters. */
  query: Record<string, string>;
  /** The parsed request URL. */
  url: URL;
  /**
   * Mutable per-request bag. Middleware writes to it (e.g. an authenticated user
   * or a validated body) and downstream middleware / the handler reads from it.
   */
  locals: Record<string, unknown>;
}

/**
 * An HTTP method handler (`GET`, `POST`, …). Receives the standard Fetch `Request`
 * plus the {@link ApiContext}. Should return (or throw) a `Response`; a plain value
 * is a convenience that gets JSON-encoded.
 */
export type ApiHandler = (request: Request, context: ApiContext) => MaybePromise<Response>;

/** Continue to the next middleware, or ultimately the route handler. */
export type NextFn = () => Promise<Response>;

/**
 * Folder middleware — the default export of a `_middleware.{js,ts}` file. Applies
 * to its folder and everything nested under it; multiple middleware compose
 * outermost-first. Call `next()` to continue, or return a `Response` to
 * short-circuit (e.g. an auth guard).
 */
export type Middleware = (request: Request, context: ApiContext, next: NextFn) => MaybePromise<Response>;

/**
 * The composed request handler produced by {@link createApiHandler}: resolves to a
 * `Response`, or `null` when no API route matched (so the caller can fall through
 * to SSR or a 404).
 */
export type RequestHandler = (request: Request) => Promise<Response | null>;

/** A discovered route module: its method-named handler exports, keyed by method. */
export type RouteModule = Partial<Record<string, ApiHandler>>;

/** A discovered `_middleware` module: the middleware is the default export. */
export interface MiddlewareModule {
  default?: Middleware;
  middleware?: Middleware;
}

export interface FetchHandlerOptions {
  /** Response for requests that match no API route (default: a 404). */
  fallback?: (request: Request) => MaybePromise<Response>;
}

/** Derive the route path from an `app/**/route.{js,ts}` file path (folder = URL). */
export function apiRouteFromPath(filePath: string): string;

/** Derive the folder route a `_middleware` file governs from its file path. */
export function middlewareScopeFromPath(filePath: string): string;

/**
 * Build the API request handler from discovered route + middleware modules (both
 * keyed by absolute file path so routes are derived from the path).
 */
export function createApiHandler(
  routeModules?: Record<string, RouteModule>,
  middlewareModules?: Record<string, MiddlewareModule>,
): RequestHandler;

/**
 * Wrap a {@link RequestHandler} into a total Fetch handler that always returns a
 * `Response` — a `null` (no route matched) becomes the `fallback` or a 404. Use it
 * to mount the handler on Fetch-native runtimes (Bun, Cloudflare Workers, Deno):
 *
 *   export default { fetch: createFetchHandler(apiHandler) };
 */
export function createFetchHandler(
  handler: RequestHandler,
  options?: FetchHandlerOptions,
): (request: Request) => Promise<Response>;
