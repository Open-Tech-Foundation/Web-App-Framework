// Types for the `@opentf/web/server` entry. The API-routes surface is fully typed
// (./api); the SSG string-builders and render helpers — authored in JS and mostly
// consumed by generated entry code — are declared with permissive signatures.

export * from "./api.js";
export * from "./cookies.js";
export * from "../core/signals.js";
export * from "../core/reactive.js";
export * from "../core/errors.js";
export * from "../core/context.js";
export * from "../runtime/lifecycle.js";
export { resource } from "../runtime/resource.js";
export { copyText, copyWithFeedback } from "../runtime/clipboard.js";

/** DOM-free built-in renderers used by the server compiler. */
export interface ServerComponent {
  (props: Record<string, unknown>, children?: string): string;
  tag: string;
  hostClass?: string;
  hostAttrs?: (props: Record<string, unknown>) => string;
}
export const Link: ServerComponent;
export const ContextProvider: ServerComponent;
export const Portal: ServerComponent;
export const ErrorBoundary: ServerComponent;
export const RawHtml: ServerComponent;
export const CodeFence: ServerComponent;
export function shouldInterceptNav(): boolean;

/** Register eager namespaces or lazy module loaders, keyed by app file path. */
export function registerRoutes(modules: Record<string, unknown>): void;
/** Request-scoped route values during SSR. */
export const router: {
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly query: Record<string, string>;
  readonly params: RouteParams;
  readonly locale: string | null;
  readonly data: unknown;
};
export function matchRoute(pathname: string): { entry: unknown; params: RouteParams; route: string } | null;
export function configureI18n(config: { locales: string[]; defaultLocale?: string } | null): void;
export function i18nLocales(): { locales: string[]; defaultLocale: string } | null;
export function resolveLocale(pathname: string): { locale: string | null; path: string };
export function localizePath(pathname: string, locale?: string | null): string;
/** Set the current request's locale during server rendering. */
export function setLocale(locale: string | null): void;
/** Set the current request's route state directly. */
export function setRouteState(state?: {
  pathname?: string;
  search?: string;
  params?: RouteParams;
  locale?: string | null;
  data?: unknown;
}): void;
/** No-op on the server: there is no mounted app to navigate. */
export function navigate(path: string, replace?: boolean): Promise<void>;
/** Always `false` during server rendering. */
export function isHydrating(): boolean;
export { emit } from "../runtime/events.js";

// ── Render / route API (render.js) ─────────────────────────────────────────────
export interface RenderResult {
  html: string;
  metadata: Record<string, unknown>;
  hydration: unknown;
  status?: number;
}
export function renderRoute(
  pathname: string,
  params?: Record<string, unknown> | null,
  search?: string,
  options?: { data?: unknown },
): Promise<RenderResult | null>;
export function renderToString(pathname: string, search?: string): Promise<string>;
export function collectRoutePaths(): Promise<{
  paths: Array<{ path: string; params: Record<string, unknown>; route: string }>;
  skipped: string[];
}>;

// ── <head> / metadata (head.js) ─────────────────────────────────────────────────
export function resolveMetadata(args?: {
  route?: string;
  entry?: unknown;
  layouts?: unknown[];
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): Promise<Record<string, unknown>>;
export function renderHead(meta?: Record<string, unknown>, opts?: { path?: string; baseUrl?: string; managed?: boolean }): string;
export function localeAlternateLinks(
  routePath: string,
  cfg?: { locales?: string[]; defaultLocale?: string },
  localize?: (path: string, locale: string) => string,
): Array<Record<string, string>>;

// ── Route loaders (loader.js) ───────────────────────────────────────────────────
import type { RouteParams } from "./api.js";

/** The context a route loader receives (docs/DATA.md). `request` is the live
 *  Request under serve/dev and undefined at SSG prerender; `locals` is reserved. */
export interface LoaderContext {
  params: RouteParams;
  query: Record<string, string>;
  request?: Request;
  locale: string | null;
  locals: Record<string, unknown>;
}

/** A route loader — the default (or named `loader`) export of a `loader.{js,ts}`
 *  file. Returns the page's JSON-serializable data. */
export type Loader = (context: LoaderContext) => unknown | Promise<unknown>;

export interface LoaderMatch {
  route: string;
  params: RouteParams;
  locale: string | null;
}

export interface LoaderRegistry {
  routes: string[];
  match(pathname: string): LoaderMatch | null;
  load(m: LoaderMatch, ctx?: { request?: Request; query?: Record<string, string> }): Promise<unknown>;
  loadSerialized(
    m: LoaderMatch,
    ctx?: { request?: Request; query?: Record<string, string> },
  ): Promise<{ data: unknown; json: string }>;
  handle(request: Request): Promise<Response | null>;
}

export function createLoaderRegistry(
  loaderModules?: Record<string, { default?: Loader; loader?: Loader }>,
  options?: { appDir?: string; i18n?: { locales?: string[]; defaultLocale?: string } },
): LoaderRegistry;
export function loaderRouteFromPath(filePath: string, appDir?: string): string;
/** Throw "this page does not exist" from inside a loader (404 semantics). */
export function notFound(message?: string): never;
export function isNotFound(e: unknown): boolean;
export function serializeRouteData(value: unknown): string;

// ── SSG string-builder helpers (ssg-runtime.js) ─────────────────────────────────
export function defineSSG(tag: string, render: (...args: any[]) => string): void;
export function beginHydrationCollect(): void;
export function endHydrationCollect(): unknown;
export function escapeHtml(s: unknown): string;
export function escapeAttr(s: unknown): string;
export function clsx(value: unknown): string;
export function styleString(value: unknown): string;
export function attr(name: string, value: unknown): string;
export function ssgText(v: unknown): string;
export function ssgList<T>(arr: T[], fn: (item: T, index: number) => string): string;
export function ssgComponent(tag: string, props?: Record<string, unknown>, children?: unknown): string;
