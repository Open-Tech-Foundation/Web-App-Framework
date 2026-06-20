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
 * Wire a text node to a reactive expression. Returns the effect disposer so the
 * caller (component lifecycle) can stop updates.
 */
export function bindText(node, fn) {
  return effect(() => {
    node.data = toText(fn());
  });
}

/** Wire an element attribute/prop to a reactive expression. Returns the disposer. */
export function bindAttr(el, name, fn) {
  return effect(() => setAttr(el, name, fn()));
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
