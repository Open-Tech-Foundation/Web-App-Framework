/**
 * Subscribe to runtime errors. `handler(error, context)` is called for every
 * `reportError`. Returns a disposer that unsubscribes.
 */
export function onError(handler: any): () => boolean;
/**
 * Report a caught error. `context` carries where it happened
 * (`{ phase: "render" | "effect" | "mount" | "event" | "route", … }`).
 * Notifies subscribers, emits the `otfw:error` window event, and — if nobody is
 * listening — logs to the console so errors are never silently swallowed.
 */
export function reportError(error: any, context?: {}): void;
/** Signal that the error condition has cleared (e.g. a successful navigation). */
export function clearError(context?: {}): void;
