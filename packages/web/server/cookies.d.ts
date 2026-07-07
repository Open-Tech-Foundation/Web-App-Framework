// Types for the cookie helpers (cookies.js) — standards-based wrappers over the
// `Cookie` / `Set-Cookie` headers, exported from `@opentf/web/server`.

/** Anything cookies can be read from: a Request (or any `.headers` carrier), a
 *  Headers, or the raw `Cookie` header string. */
export type CookieSource = Request | Headers | { headers: Headers } | string;

/** Anything a `Set-Cookie` header can be appended to: a Response (or any
 *  `.headers` carrier) or a Headers. */
export type CookieTarget = Response | Headers | { headers: Headers };

export interface CookieOptions {
  /** Defaults to `"/"`; pass `null` to omit (the spec then scopes to the request's path). */
  path?: string | null;
  domain?: string;
  /** Lifetime in seconds. */
  maxAge?: number;
  /** A `Date`, or anything `new Date(...)` accepts (ISO string, epoch ms). */
  expires?: Date | string | number;
  httpOnly?: boolean;
  secure?: boolean;
  /** `"None"` requires `secure: true` (enforced at write time). */
  sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
  partitioned?: boolean;
}

/** Parse cookies into `{ name: value }` (percent-decoded; first duplicate wins). */
export function getCookies(source: CookieSource): Record<string, string>;

/** One cookie's (percent-decoded) value, or `undefined` when absent. */
export function getCookie(source: CookieSource, name: string): string | undefined;

/** Serialize one `Set-Cookie` header value (value percent-encoded). */
export function serializeCookie(name: string, value: string, options?: CookieOptions): string;

/** Append a `Set-Cookie` header to a Response/Headers; returns the serialized value. */
export function setCookie(target: CookieTarget, name: string, value: string, options?: CookieOptions): string;

/** Expire a cookie on the client (`Max-Age=0`); `path`/`domain` must match how it was set. */
export function deleteCookie(
  target: CookieTarget,
  name: string,
  options?: Pick<CookieOptions, "path" | "domain">,
): string;
