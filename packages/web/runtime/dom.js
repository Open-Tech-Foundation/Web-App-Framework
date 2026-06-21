// Zero-VDOM DOM operations. CSR codegen emits calls into these helpers; they
// also back runtime-driven updates (reactive text/attributes). No virtual DOM,
// no diffing — just direct, fine-grained DOM writes wired to signals.

import { effect, signal } from "../core/signals.js";

// Attribute names that must be assigned as JS properties (not setAttribute) for
// correct behavior. Mirrors the set the old runtime relied on (core/constants).
const AS_PROPERTY = new Set([
  "value",
  "checked",
  "selected",
  "disabled",
  "readOnly",
  "className",
  "htmlFor",
  "indeterminate",
]);

// Enumerated attributes: their value is a keyword string ("true"/"false"), not a
// boolean-attribute presence toggle. `draggable={true}` must become
// draggable="true" — draggable="" reads back as the default (false). ARIA states
// behave the same (aria-*="true"/"false").
const ENUMERATED = new Set(["draggable", "spellcheck", "contenteditable"]);

/** Render a reactive value to its text form: null/undefined/false → "". */
export function toText(value) {
  return value == null || value === false ? "" : String(value);
}

/**
 * Apply a single static prop/attribute. Handles `style` objects, `on*` event
 * handlers, property-backed attributes, and boolean/nullish removal; everything
 * else falls back to `setAttribute`.
 */
export function setAttr(el, name, value) {
  if (name === "style" && value && typeof value === "object") {
    Object.assign(el.style, value);
    return;
  }
  if (name.startsWith("on") && typeof value === "function") {
    el[name.toLowerCase()] = value;
    return;
  }
  if (AS_PROPERTY.has(name)) {
    el[name] = value;
    return;
  }
  if (ENUMERATED.has(name) || name.startsWith("aria-")) {
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? "true" : value === false ? "false" : String(value));
    return;
  }
  if (value == null || value === false) {
    el.removeAttribute(name);
    return;
  }
  if (value === true) {
    el.setAttribute(name, "");
    return;
  }
  el.setAttribute(name, String(value));
}

/**
 * Apply every own enumerable key of `obj` to `el` (`<div {...obj}/>`, SPEC §5.5).
 * `asProps` sets element properties (for components) instead of attributes (for
 * host elements). Keys are applied in object order; the caller wraps this in an
 * effect so a reactive source re-applies.
 */
export function spread(el, obj, asProps) {
  if (!obj) return;
  for (const k in obj) {
    if (asProps) el[k] = obj[k];
    else setAttr(el, k, obj[k]);
  }
}

/**
 * Wire a text node to a reactive expression. Primitive values update the text in
 * place; a DOM node (or array of them) — e.g. JSX stored as a value, `{iconMap[k]}`
 * — is inserted before the text node, which stays as a stable anchor. Returns the
 * effect disposer so the caller (component lifecycle) can stop updates.
 */
export function bindText(node, fn) {
  let inserted = [];
  return effect(() => {
    const value = fn();
    for (const n of inserted) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    inserted = [];
    if (value instanceof Node || Array.isArray(value)) {
      node.data = "";
      const parent = node.parentNode;
      if (parent) {
        for (const n of toNodes(value)) {
          parent.insertBefore(n, node);
          inserted.push(n);
        }
      }
    } else {
      node.data = toText(value);
    }
  });
}

/** Wire an element attribute/prop to a reactive expression. Returns the disposer. */
export function bindAttr(el, name, fn) {
  return effect(() => setAttr(el, name, fn()));
}

/** Flatten a reactive child value into DOM nodes: nodes pass through, arrays
 * recurse, nullish/booleans render nothing, primitives become text nodes. */
function toNodes(value) {
  if (value == null || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) for (const n of toNodes(v)) out.push(n);
    return out;
  }
  if (value instanceof Node) return [value];
  return [document.createTextNode(String(value))];
}

/**
 * Wire a dynamic child region (conditional/element-valued holes like
 * `{cond && <p/>}` or `{cond ? <a/> : <b/>}`) to a reactive expression. The
 * region is delimited by `anchor` (a comment); on every change the previous
 * nodes are replaced with the new ones, inserted just before the anchor.
 * Returns the effect disposer.
 */
export function bindChild(anchor, fn) {
  let current = [];
  return effect(() => {
    const next = toNodes(fn());
    const host = anchor.parentNode;
    for (const n of current) {
      if (n.parentNode === host) host.removeChild(n);
    }
    if (host) for (const n of next) host.insertBefore(n, anchor);
    current = next;
  });
}

/**
 * Render a keyed list (`array.map(...)`, SPEC §5.4.4) into `parent`, reconciling
 * by key on every change to `sourceFn`'s dependencies.
 *
 * - `sourceFn()` returns the current array (plain data).
 * - `renderItem(itemSignal, index)` builds a node for a new item; the item's
 *   value is a signal so per-item bindings update fine-grained on data changes.
 * - `keyFn(item, index)` returns a stable key; falls back to `index` when omitted.
 *
 * Returns the effect disposer (stops reconciliation; used by component cleanup).
 */
export function bindList(parent, sourceFn, renderItem, keyFn) {
  const anchor = document.createComment("");
  parent.appendChild(anchor);
  let cache = new Map(); // key -> { sig, node }

  return effect(() => {
    const data = sourceFn();
    const items = Array.isArray(data) ? data : [];
    const next = new Map();
    const nodes = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const key = keyFn ? keyFn(item, index) : index;
      let entry = cache.get(key);
      if (entry) {
        cache.delete(key);
        entry.sig.value = item; // fine-grained per-item update
      } else {
        const sig = signal(item);
        entry = { sig, node: renderItem(sig, index) };
      }
      next.set(key, entry);
      nodes.push(entry.node);
    }

    // Remove nodes whose keys disappeared.
    for (const entry of cache.values()) {
      if (entry.node.parentNode) entry.node.parentNode.removeChild(entry.node);
    }
    cache = next;

    // Place nodes in order, just before the anchor (works even after the
    // initial fragment has been flushed into the real parent).
    const host = anchor.parentNode || parent;
    let ref = anchor;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.nextSibling !== ref) host.insertBefore(node, ref);
      ref = node;
    }
  });
}
