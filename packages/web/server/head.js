//! SEO head resolution + rendering for SSG (ARCHITECTURE.md §6, SPEC §9).
//! Runs in plain Bun/Node at build time and returns the inner HTML of `<head>`.
//!
//! Pages/layouts declare metadata with a Next-style plain-data API:
//!   export const metadata = { title, description, canonical, openGraph, twitter,
//!                             robots, jsonLd, meta: [...], links: [...] };
//!   export function generateMetadata({ params, query }) { return { ... }; }
//! Both are read off the eager-imported module namespace (the SSG route entries
//! ARE the namespaces — see runtime/router.js), so no compiler change is needed.

import { layoutChain } from "../runtime/router.js";
import { escapeAttr, escapeHtml } from "./ssg-runtime.js";

// Sub-objects that merge one level deep (rather than wholesale replace) so a page
// can override `openGraph.image` without dropping a layout's `openGraph.siteName`.
const SUBOBJECTS = ["openGraph", "twitter", "robots"];

/** Read a route entry's static `metadata` (namespace or its default export). */
function staticMeta(entry) {
  if (!entry || typeof entry === "function") return null;
  return entry.metadata || (entry.default && entry.default.metadata) || null;
}

/** Invoke a route entry's `generateMetadata({ params, query })` if it exports one. */
async function dynamicMeta(entry, params, query) {
  if (!entry || typeof entry === "function") return null;
  const gen = entry.generateMetadata || (entry.default && entry.default.generateMetadata);
  return typeof gen === "function" ? (await gen({ params, query })) || null : null;
}

/** Merge `add` over `base`, deep-merging the known sub-objects. */
function mergeMeta(base, add) {
  if (!add) return base;
  const out = { ...base };
  for (const k in add) {
    const v = add[k];
    if (v == null) continue;
    if (SUBOBJECTS.includes(k) && isPlainObject(v) && isPlainObject(base[k])) {
      out[k] = { ...base[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Resolve the effective metadata for a route by merging, least- to most-specific:
 * each layout's static then dynamic metadata (root → leaf), then the page's static
 * then dynamic metadata. The most specific (page `generateMetadata`) wins.
 */
export async function resolveMetadata({ route, entry, params = {}, query = {} } = {}) {
  let meta = {};
  for (const layout of layoutChain(route)) {
    meta = mergeMeta(meta, staticMeta(layout));
    meta = mergeMeta(meta, await dynamicMeta(layout, params, query));
  }
  meta = mergeMeta(meta, staticMeta(entry));
  meta = mergeMeta(meta, await dynamicMeta(entry, params, query));
  return meta;
}

/** Resolve a possibly-relative URL against `baseUrl` (absolute URLs pass through). */
function absUrl(baseUrl, p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  if (!baseUrl) return p; // no site origin configured → emit relative
  return baseUrl.replace(/\/+$/, "") + (p.startsWith("/") ? p : `/${p}`);
}

/**
 * Resolve a `title` (string or `{ absolute }`) against an optional `template`
 * containing `%s`. A plain string is wrapped by the template; `{ absolute }` (or a
 * template without `%s`) is used verbatim. Returns null when there is no title.
 */
function resolveTitle(title, template) {
  if (title != null && typeof title === "object") {
    return title.absolute != null ? String(title.absolute) : null;
  }
  if (title == null) return null;
  const s = String(title);
  return template && template.includes("%s") ? template.replace("%s", s) : s;
}

/** `<meta name|property="key" content="value">` (omitted when value is null). */
function metaTag(kind, key, content) {
  if (content == null || content === "") return "";
  return `<meta ${kind}="${escapeAttr(key)}" content="${escapeAttr(content)}">`;
}

/** Normalize `robots` (string passthrough, or `{ index, follow, ... }` flags). */
function robotsContent(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  const parts = [];
  if (r.index === false) parts.push("noindex");
  else if (r.index === true) parts.push("index");
  if (r.follow === false) parts.push("nofollow");
  else if (r.follow === true) parts.push("follow");
  for (const flag of ["noarchive", "nosnippet", "noimageindex", "notranslate"]) {
    if (r[flag]) parts.push(flag);
  }
  return parts.join(", ");
}

// Escape `</script>` / `<` so a JSON-LD payload can't break out of the script tag.
function jsonLdSafe(s) {
  return String(s).replace(/</g, "\\u003c");
}

/**
 * Render the resolved `meta` to the inner HTML of `<head>` for the route at `path`.
 * `baseUrl` (site origin) makes canonical / og:url / image URLs absolute when set.
 */
export function renderHead(meta = {}, { path = "/", baseUrl = "" } = {}) {
  const tags = [];
  const push = (s) => s && tags.push(s);

  // Resolve the display title. `title` is a string (wrapped by an inherited
  // `titleTemplate` like "%s — OTF Web") or `{ absolute }` to bypass the template —
  // so a layout can brand every child page while the homepage keeps a bespoke title.
  const title = resolveTitle(meta.title, meta.titleTemplate);
  const description = meta.description;
  if (title != null) push(`<title>${escapeHtml(title)}</title>`);
  push(metaTag("name", "description", description));

  const canonical = absUrl(baseUrl, meta.canonical ?? path);
  if (canonical) push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);

  push(metaTag("name", "robots", robotsContent(meta.robots)));

  // Open Graph (falls back to the top-level title/description).
  const og = isPlainObject(meta.openGraph) ? meta.openGraph : {};
  const ogImage = og.image ? absUrl(baseUrl, og.image) : "";
  push(metaTag("property", "og:title", og.title ?? title));
  push(metaTag("property", "og:description", og.description ?? description));
  push(metaTag("property", "og:type", og.type ?? "website"));
  push(metaTag("property", "og:url", og.url ? absUrl(baseUrl, og.url) : canonical));
  push(metaTag("property", "og:image", ogImage));
  push(metaTag("property", "og:site_name", og.siteName));

  // Twitter Card (falls back to Open Graph / top-level values).
  const tw = isPlainObject(meta.twitter) ? meta.twitter : {};
  const twImage = tw.image ? absUrl(baseUrl, tw.image) : ogImage;
  push(metaTag("name", "twitter:card", tw.card ?? (twImage ? "summary_large_image" : "summary")));
  push(metaTag("name", "twitter:title", tw.title ?? og.title ?? title));
  push(metaTag("name", "twitter:description", tw.description ?? og.description ?? description));
  push(metaTag("name", "twitter:image", twImage));

  // Arbitrary extra tags (escape hatch for anything not modeled above).
  for (const m of Array.isArray(meta.meta) ? meta.meta : []) {
    const kind = m.name ? "name" : m.property ? "property" : m.httpEquiv ? "http-equiv" : null;
    if (kind) push(metaTag(kind, m.name ?? m.property ?? m.httpEquiv, m.content));
  }
  for (const l of Array.isArray(meta.links) ? meta.links : []) {
    const rel = l.rel ? ` rel="${escapeAttr(l.rel)}"` : "";
    const href = l.href ? ` href="${escapeAttr(absUrl(baseUrl, l.href))}"` : "";
    const type = l.type ? ` type="${escapeAttr(l.type)}"` : "";
    const extra = l.hreflang ? ` hreflang="${escapeAttr(l.hreflang)}"` : "";
    if (rel || href) push(`<link${rel}${type}${href}${extra}>`);
  }

  // Structured data (JSON-LD) for rich results.
  if (meta.jsonLd != null) {
    const json = typeof meta.jsonLd === "string" ? meta.jsonLd : JSON.stringify(meta.jsonLd);
    push(`<script type="application/ld+json">${jsonLdSafe(json)}</script>`);
  }

  return tags.join("\n");
}

/**
 * Build `rel="alternate" hreflang` link descriptors for a locale-agnostic
 * `routePath` (e.g. `/about`) across all configured locales — for the toolchain to
 * pass through `metadata.links` so `renderHead` emits them (docs/I18N.md §6). The
 * default locale also gets `x-default`. `localize(path, locale)` is the router's
 * `localizePath` (kept as a param so this stays free of a router import here).
 */
export function localeAlternateLinks(routePath, { locales, defaultLocale } = {}, localize) {
  if (!Array.isArray(locales) || locales.length === 0 || typeof localize !== "function") return [];
  const links = locales.map((locale) => ({
    rel: "alternate",
    hreflang: locale,
    href: localize(routePath, locale),
  }));
  links.push({ rel: "alternate", hreflang: "x-default", href: localize(routePath, defaultLocale) });
  return links;
}
