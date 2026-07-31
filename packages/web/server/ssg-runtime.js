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

// ── hydration props collector (compiler-driven data hydration) ────────────────
// The lossy path is passing rich props through string attributes. Instead, each
// server-rendered island gets a `data-h` id and its JSON-safe props are recorded into a
// single payload the shell embeds as `<script type="application/json">`. At upgrade the
// client component initializes its prop *signals* from those real JS values (objects,
// arrays, numbers) — not from `getAttribute` — so islands resume with correct data, with
// no flash and no dependence on a parent walk re-applying props. `renderRoute` brackets a
// render with `beginHydrationCollect()` / `endHydrationCollect()`.
let _collect = null;

/** Start collecting per-island hydration props for one render. */
export function beginHydrationCollect() {
  _collect = [];
}

/**
 * Finish collecting and return the payload as a JSON string ("" when nothing needs
 * hydration). `<` is escaped so a prop value can never break out of the surrounding
 * `<script>` (a `</script>` / `<!--` injection).
 */
export function endHydrationCollect() {
  const data = _collect;
  _collect = null;
  if (!data || data.length === 0) return "";
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Record an island's JSON-safe props, returning its hydration id — or `null` when not
 * collecting, or when nothing serializes. A JSON round-trip drops functions (event
 * callbacks are client-only — applied by the parent walk, invisible so no flash),
 * `undefined`, and anything cyclic/DOM/signal-shaped, so only plain data crosses.
 */
function collectHydrationProps(props) {
  if (!_collect) return null;
  const safe = jsonSafeProps(props);
  if (!safe) return null;
  const id = _collect.length;
  _collect.push(safe);
  return id;
}

/** A component's props with everything the payload can't carry dropped, or `null` when
 * nothing is left to send. A JSON round-trip drops functions, `undefined`, and anything
 * cyclic/DOM/signal-shaped. */
function jsonSafeProps(props) {
  if (props == null || typeof props !== "object") return null;
  let safe;
  try {
    safe = JSON.parse(JSON.stringify(props));
  } catch {
    return null; // cyclic / non-serializable → client falls back to attributes/defaults
  }
  if (!safe || typeof safe !== "object" || Object.keys(safe).length === 0) return null;
  return safe;
}

/**
 * An island's props as an inline `data-hp` attribute — the fallback for one rendered
 * *outside* a route render.
 *
 * A JSX value held in module-level data (`export const tabs = [{ content: <CodeBlock/> }]`,
 * the MDX idiom) is rendered when the module is imported, before any `beginHydrationCollect`
 * bracket, so there is no payload to record its props in and no `data-h` id to key them by.
 * The markup is then spliced into whatever page reads it (see `ssgText`) and re-parsed on
 * the client, where the island would upgrade with no props at all and blank its own
 * content. Carrying the props on the host keeps that markup self-contained: it hydrates
 * correctly wherever it ends up, at the cost of a few bytes on those hosts only.
 */
function inlineHydrationProps(props) {
  const safe = jsonSafeProps(props);
  if (!safe) return "";
  return JSON.stringify(safe).replace(/[&"<]/g, (c) => (c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&lt;"));
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

/**
 * A dynamic hole's value → HTML: trusted `{__html}` raw, else escaped text. An
 * array (`{[<a/>, <b/>]}` or `{[1, 2, 3]}`) renders each item concatenated with no
 * separator — mirroring CSR's `toNodes`/`bindText`, where an array value inserts one
 * node per item. Without this an array would stringify to `[object Object]` (JSX) or
 * a comma-joined string, diverging from the hydrated client render.
 */
export function ssgText(v) {
  if (v == null || v === false || v === true) return "";
  if (Array.isArray(v)) return v.map(ssgText).join("");
  if (typeof v === "object" && v.__html != null) return v.__html;
  return escapeHtml(String(v));
}

/**
 * A dynamic hole inside a **raw text** element (`<script>`, `<style>`): written verbatim.
 *
 * The tokenizer does not parse markup — or character references — in there, so escaping
 * would be served literally (`a &gt; b` in a stylesheet is the entity, not `>`), and the
 * CSR path, which puts the value in the element's text node, doesn't escape either. The
 * one sequence that must not survive is the element's own closing tag: `</script` inside
 * the value would end the element early and spill the rest into the document. It is
 * written as `<\/script`, which the tokenizer no longer recognizes as an end tag and
 * which JavaScript reads back identically inside the string literal such a sequence
 * almost always sits in. `<textarea>`/`<title>` are *escapable* raw text — they resolve
 * character references — so their holes go through `ssgText` instead.
 */
export function ssgRawText(v) {
  if (v == null || v === false || v === true) return "";
  if (Array.isArray(v)) return v.map(ssgRawText).join("");
  return String(v).replace(/<\/(script|style|textarea|title|xmp|iframe|noembed|noframes)/gi, "<\\/$1");
}

/** Render an array.map list to concatenated HTML. */
export function ssgList(arr, fn) {
  return (Array.isArray(arr) ? arr : []).map(fn).join("");
}

/**
 * Render a child component `<tag>inner</tag>` via the registry. Props are passed to
 * the renderer (which decides where they land — declared props become properties /
 * forward into the view), so the host tag carries no reflected attributes — exactly
 * as CSR composes a component (props go through `setProp`, declared ones as
 * properties, not host attributes). Avoids duplicating e.g. `class` on both the
 * host and the element the component renders.
 */
export function ssgComponent(tag, props, children) {
  const render = registry[tag];
  let inner;
  try {
    inner = render ? render(props || {}, children ?? "") : (children ?? "");
  } catch {
    inner = ""; // fail soft (client renders/handles it)
  }
  // Stamp the stable styling hook on the host (mirrors CSR's `classList.add`) so
  // tag-hashed components are still styleable by a readable class name, plus the
  // hydration id (`data-h`) keying this island's rich props in the payload (if any).
  const cls = render && render.hostClass;
  const id = collectHydrationProps(props);
  let attrs = cls ? ` class="${cls}"` : "";
  if (id != null) {
    attrs += ` data-h="${id}"`;
  } else {
    // Rendered outside a route render (module-level JSX-as-value): carry the props on
    // the host itself so the markup hydrates wherever it is spliced in.
    const inline = inlineHydrationProps(props);
    if (inline) attrs += ` data-hp="${inline}"`;
  }
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

export { VOID };
