//! Central error reporting for the OTF Web runtime.
//
// Render, effect, lifecycle, and event errors are funneled here instead of being
// thrown into the void. Userland (and the dev overlay) subscribe via `onError`;
// in the browser every report is also dispatched as an `otfw:error` window event
// so a fully decoupled listener (e.g. the dev server's injected overlay) can show
// it without importing the bundle.

const handlers = new Set();
const isBrowser = typeof window !== "undefined";

/**
 * Subscribe to runtime errors. `handler(error, context)` is called for every
 * `reportError`. Returns a disposer that unsubscribes.
 */
export function onError(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * Report a caught error. `context` carries where it happened
 * (`{ phase: "render" | "effect" | "mount" | "event" | "route", … }`).
 * Notifies subscribers, emits the `otfw:error` window event, and — if nobody is
 * listening — logs to the console so errors are never silently swallowed.
 */
export function reportError(error, context = {}) {
  for (const handler of handlers) {
    try {
      handler(error, context);
    } catch {
      // A failing handler must not mask the original error.
    }
  }
  if (isBrowser) {
    window.dispatchEvent(new CustomEvent("otfw:error", { detail: { error, context } }));
  }
  if (handlers.size === 0) {
    console.error(`[otfw${context.phase ? `:${context.phase}` : ""}]`, error);
  }
}

/** Signal that the error condition has cleared (e.g. a successful navigation). */
export function clearError(context = {}) {
  if (isBrowser) {
    window.dispatchEvent(new CustomEvent("otfw:error-clear", { detail: context }));
  }
}
