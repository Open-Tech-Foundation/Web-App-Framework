// Context tokens and host lookup, shared by browser and server entries.
import { signal } from "./signals.js";

let nextId = 0;

// Stack of the elements whose component bodies are currently executing. A stack
// (not a single slot) because filling a component's children slot connects nested
// components synchronously inside the parent's connect — each push is balanced by
// a pop in the generated `finally`, so the parent's host is restored after.
const hostStack = [];

/** Push the current component host (compiler-emitted, paired with `exitHost`). */
export function enterHost(el) {
  hostStack.push(el);
}

/** Pop the current component host (compiler-emitted, in a `finally`). */
export function exitHost() {
  hostStack.pop();
}

/**
 * The component host element currently executing its body, or `null` outside a
 * component (e.g. a form created in module scope or a test). Libraries use this
 * as a per-instance identity to scope state to the mounting component — the
 * compiler emits `enterHost(this)` around every component body (csr.rs).
 */
export function getCurrentInstance() {
  return hostStack[hostStack.length - 1] ?? null;
}

/**
 * Create a context with a default value. The returned token is passed to
 * `<ContextProvider context={…}>` and `$context(…)`.
 */
export function createContext(defaultValue) {
  return { id: `otfw-ctx-${nextId++}`, fallback: signal(defaultValue) };
}

/**
 * Resolve the value provided by the nearest ancestor `ContextProvider` for
 * `context`, or the context's default if there is none. Returns a **signal**. This
 * is what the `$context(Ctx)` compiler macro lowers to; the macro registers the
 * binding as a signal so the bare name reads `.value` reactively.
 */
export function readContext(context) {
  let el = hostStack[hostStack.length - 1];
  const sel = `[data-otfw-ctx~="${context.id}"]`;
  // Walk up the DOM; when the search reaches a portal boundary without finding a
  // provider, hop to the portal's logical location (`__portalHost`) and continue,
  // so context resolves across a <Portal> as if the content were still in place.
  while (el) {
    const provider = el.closest(sel);
    if (provider) return provider._signal;
    const boundary = el.closest("[data-otfw-portal]");
    el = boundary ? boundary.__portalHost : null;
  }
  return context.fallback;
}

