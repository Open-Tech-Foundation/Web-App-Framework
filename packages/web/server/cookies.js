// Cookie helpers for server code (middleware, API handlers, loaders) — thin,
// standards-based wrappers over the `Cookie` / `Set-Cookie` headers (RFC 6265),
// so nobody hand-rolls header parsing or serialization:
//
//   import { getCookie, setCookie, deleteCookie } from "@opentf/web/server";
//
//   // read (middleware/handler/loader — anything holding the Request)
//   const session = getCookie(request, "session");
//
//   // write — appends a Set-Cookie header to a Response (or Headers)
//   const res = Response.json({ ok: true });
//   setCookie(res, "session", token, { httpOnly: true, maxAge: 3600 });
//
// Values are percent-encoded on write and decoded on read, so any string round-
// trips. Reading accepts a `Request` (or anything with `.headers`), a `Headers`,
// or the raw `Cookie` header string. Writing accepts a `Response` (or anything
// with `.headers`) or a `Headers`; note a *fetched* Response has immutable
// headers — wrap it first (`new Response(res.body, res)`), which the middleware
// response-decoration pattern (docs/MIDDLEWARE.md) does anyway.

// RFC 6265 cookie-name: an HTTP token (no separators/whitespace/control chars).
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // malformed input stays raw rather than throwing
  }
};

/** The Headers of a Request/Response-like target, or the Headers itself. */
const headersOf = (target) => (target instanceof Headers ? target : target?.headers);

/**
 * Parse cookies into a plain `{ name: value }` object. `source` is a `Request`
 * (or anything with `.headers`), a `Headers`, or the raw `Cookie` header string.
 * Values arrive percent-decoded; on a duplicate name the first occurrence wins
 * (the most specific cookie is sent first — RFC 6265 §5.4).
 */
export function getCookies(source) {
  const header =
    typeof source === "string" ? source : (headersOf(source)?.get("cookie") ?? "");
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    // Tolerate the optional RFC 6265 double-quoted form.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = decode(value);
  }
  return out;
}

/** One cookie's (percent-decoded) value, or `undefined` when absent. */
export function getCookie(source, name) {
  return getCookies(source)[name];
}

/**
 * Serialize one `Set-Cookie` header value. The value is percent-encoded (any
 * string round-trips through `getCookie`). `path` defaults to `"/"` — the
 * almost-always-right choice (the spec default is the *request's* path, a
 * classic footgun); pass `path: null` to omit it.
 *
 * Options: `path`, `domain`, `maxAge` (seconds), `expires` (Date or date
 * string/ms), `httpOnly`, `secure`, `sameSite` ("Strict" | "Lax" | "None"),
 * `partitioned`. `sameSite: "None"` requires `secure: true` (browsers reject it
 * otherwise) — enforced here so the mistake fails loudly at write time.
 */
export function serializeCookie(name, value, options = {}) {
  if (!NAME.test(name)) throw new TypeError(`invalid cookie name: ${JSON.stringify(name)}`);
  const { path = "/", domain, maxAge, expires, httpOnly, secure, sameSite, partitioned } = options;
  let out = `${name}=${encodeURIComponent(value)}`;
  if (path != null) out += `; Path=${path}`;
  if (domain) out += `; Domain=${domain}`;
  if (maxAge != null) {
    if (!Number.isFinite(maxAge)) throw new TypeError(`invalid cookie maxAge: ${maxAge}`);
    out += `; Max-Age=${Math.trunc(maxAge)}`;
  }
  if (expires != null) {
    const d = expires instanceof Date ? expires : new Date(expires);
    if (Number.isNaN(d.getTime())) throw new TypeError(`invalid cookie expires: ${expires}`);
    out += `; Expires=${d.toUTCString()}`;
  }
  if (httpOnly) out += `; HttpOnly`;
  if (secure) out += `; Secure`;
  if (sameSite != null) {
    const norm = { strict: "Strict", lax: "Lax", none: "None" }[String(sameSite).toLowerCase()];
    if (!norm) throw new TypeError(`invalid cookie sameSite: ${sameSite}`);
    if (norm === "None" && !secure) {
      throw new TypeError(`sameSite: "None" requires secure: true (browsers reject it otherwise)`);
    }
    out += `; SameSite=${norm}`;
  }
  if (partitioned) out += `; Partitioned`;
  return out;
}

/**
 * Append a `Set-Cookie` header to `target` — a `Response` (or anything with
 * `.headers`) or a `Headers`. Appends, never overwrites, so multiple cookies on
 * one response coexist (session + CSRF). Returns the serialized header value.
 */
export function setCookie(target, name, value, options) {
  const serialized = serializeCookie(name, value, options);
  headersOf(target).append("set-cookie", serialized);
  return serialized;
}

/**
 * Expire a cookie on the client: an empty value with `Max-Age=0` and an epoch
 * `Expires`. `path`/`domain` must match how the cookie was set or the browser
 * treats it as a different cookie and keeps the original.
 */
export function deleteCookie(target, name, { path = "/", domain } = {}) {
  return setCookie(target, name, "", { path, domain, maxAge: 0, expires: new Date(0) });
}
