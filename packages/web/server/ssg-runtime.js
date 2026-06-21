//! SSG runtime helpers — the string-building primitives the SSG codegen emits
//! (ARCHITECTURE.md §6). No DOM: these run in plain Bun/Node at build time and
//! return HTML strings. Component output is composed via a tag→renderer registry,
//! mirroring how CSR composes by Custom Element tag.

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

const UNITLESS = new Set([
  "opacity", "zIndex", "fontWeight", "lineHeight", "flex", "flexGrow", "flexShrink",
  "order", "zoom", "tabSize", "columnCount", "fillOpacity", "strokeOpacity",
]);

const registry = {};

/** Register a component's SSG renderer under its Custom Element tag. */
export function defineSSG(tag, render) {
  registry[tag] = render;
}

/** Escape text content for HTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Escape an attribute value. */
export function escapeAttr(s) {
  return String(s).replace(/[&"]/g, (c) => (c === "&" ? "&amp;" : "&quot;"));
}

/** clsx-style class normalization (mirrors runtime/dom.js). */
export function clsx(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (const v of value) {
      const s = clsx(v);
      if (s) parts.push(s);
    }
    return parts.join(" ");
  }
  if (typeof value === "object") {
    const parts = [];
    for (const k in value) if (value[k]) parts.push(k);
    return parts.join(" ");
  }
  return "";
}

/** Serialize a style value (string passthrough, or object → `prop:val;`). */
export function styleString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  let s = "";
  for (const k in value) {
    const v = value[k];
    if (v == null) continue;
    const prop = k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    const val = typeof v === "number" && !UNITLESS.has(k) ? `${v}px` : v;
    s += `${prop}:${val};`;
  }
  return s;
}

/** Render one attribute: ` name="value"`, ` name` (true), or "" (null/false). */
export function attr(name, value) {
  if (name === "class") value = clsx(value);
  else if (name === "style") value = styleString(value);
  if (value == null || value === false) return "";
  if (value === true) return ` ${name}`;
  return ` ${name}="${escapeAttr(String(value))}"`;
}

/** A dynamic hole's value → HTML: trusted `{__html}` raw, else escaped text. */
export function ssgText(v) {
  if (v == null || v === false || v === true) return "";
  if (typeof v === "object" && v.__html != null) return v.__html;
  return escapeHtml(String(v));
}

/** Render an array.map list to concatenated HTML. */
export function ssgList(arr, fn) {
  return (Array.isArray(arr) ? arr : []).map(fn).join("");
}

/** Render a child component `<tag …>inner</tag>` via the registry. */
export function ssgComponent(tag, props, children) {
  const render = registry[tag];
  let inner;
  try {
    inner = render ? render(props || {}, children ?? "") : (children ?? "");
  } catch {
    inner = ""; // fail soft (client renders/handles it)
  }
  return `<${tag}${reflectAttrs(props)}>${inner}</${tag}>`;
}

/** Reflect scalar props as attributes on a component tag (for first paint / SEO). */
function reflectAttrs(props) {
  if (!props) return "";
  let s = "";
  for (const k in props) {
    const v = props[k];
    if (k === "children" || k === "ref" || (k.startsWith("on") && k.length > 2)) continue;
    if (typeof v === "function" || v == null || typeof v === "object") continue;
    if (v === false) continue;
    s += v === true ? ` ${k}` : ` ${k}="${escapeAttr(String(v))}"`;
  }
  return s;
}

export { VOID };
