// Types for the `@opentf/web/server` entry. The API-routes surface is fully typed
// (./api); the SSG string-builders and render helpers — authored in JS and mostly
// consumed by generated entry code — are declared with permissive signatures.

export * from "./api.js";

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
): Promise<RenderResult | null>;
export function renderToString(pathname: string, search?: string): Promise<string>;
export function collectRoutePaths(): Promise<string[]>;

// ── <head> / metadata (head.js) ─────────────────────────────────────────────────
export function resolveMetadata(args?: {
  route?: string;
  entry?: unknown;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): Promise<Record<string, unknown>>;
export function renderHead(meta?: Record<string, unknown>, opts?: { path?: string; baseUrl?: string }): string;
export function localeAlternateLinks(
  routePath: string,
  cfg?: { locales?: string[]; defaultLocale?: string },
  localize?: (path: string, locale: string) => string,
): Array<Record<string, string>>;

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
