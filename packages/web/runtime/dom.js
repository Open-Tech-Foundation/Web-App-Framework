// Zero-VDOM DOM operations. CSR codegen emits calls into these helpers; they
// also back runtime-driven updates (reactive text/attributes). No virtual DOM,
// no diffing — just direct, fine-grained DOM writes wired to signals.

import { effect } from "../core/signals.js";

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
