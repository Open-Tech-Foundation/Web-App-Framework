//! ErrorBoundary — catch render/mount errors from descendant components and show
//! a fallback instead of letting the broken subtree (or its siblings) take the
//! page down.
//
//   <ErrorBoundary fallback={(error, reset) => `Oops: ${error.message}`}>
//     <Risky/>
//   </ErrorBoundary>
//
// A descendant component's connectedCallback funnels a thrown error through
// `handleError(this, …)` (emitted by the compiler): it reports the error (dev
// overlay / logging) and walks up the DOM — hopping across portals, like
// `readContext` — to the nearest `web-internal-error-boundary`, which swaps its children
// for the fallback. `reset()` rebuilds the original subtree (snapshotted before it
// ran) to retry. Only synchronous render/mount errors are caught; later
// effect/event errors still go to global reporting (as with React boundaries).

import { reportError } from "../core/errors.js";

/**
 * Report a caught render/mount error and route it to the nearest enclosing
 * `<ErrorBoundary>`. Called from a throwing component's connectedCallback catch.
 */
export function handleError(el, error, context = {}) {
  reportError(error, context); // always log / surface in the dev overlay
  let node = el;
  while (node) {
    const boundary = node.closest ? node.closest("web-internal-error-boundary") : null;
    if (boundary) {
      boundary.catch(error, context);
      return;
    }
    const portal = node.closest ? node.closest("[data-otfw-portal]") : null;
    node = portal ? portal.__portalHost : null;
  }
}

// A self-contained fallback (inline-styled so it reads fine without any app CSS).
function defaultFallback(message, reset) {
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.setAttribute("data-otfw-fallback", "");
  box.style.cssText =
    "display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;border:1px solid #ef4444;" +
    "border-radius:.5rem;background:rgba(239,68,68,.1);color:#fca5a5;font:14px system-ui,sans-serif";
  const text = document.createElement("span");
  text.textContent = message;
  box.appendChild(text);
  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.style.cssText =
    "margin-left:auto;padding:.25rem .75rem;border-radius:.375rem;border:none;cursor:pointer;" +
    "background:#ef4444;color:#fff;font:inherit";
  retry.addEventListener("click", reset);
  box.appendChild(retry);
  return box;
}

export class ErrorBoundaryElement extends HTMLElement {
  set fallback(fn) {
    this._fallback = fn;
  }
  get fallback() {
    return this._fallback;
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    // Snapshot the children before they connect (and possibly throw) so reset()
    // can rebuild a pristine subtree.
    this._blueprint = Array.from(this.childNodes).map((n) => n.cloneNode(true));
  }

  // Invoked by handleError when a descendant throws during render/mount. Deferred
  // to a microtask so we never mutate the tree mid-connectedCallback (re-entrancy).
  catch(error) {
    if (this._failed) return; // first error wins; ignore the cascade
    this._failed = true;
    queueMicrotask(() => this.#renderFallback(error));
  }

  #renderFallback(error) {
    this.replaceChildren(); // tear the broken subtree down (runs disconnect cleanups)
    const reset = () => this.reset();
    let view = null;
    try {
      view = this._fallback ? this._fallback(error, reset) : null;
    } catch (e) {
      reportError(e, { phase: "fallback" });
    }
    const message = typeof view === "string" ? view : (error && error.message) || "Something went wrong";
    this.appendChild(view instanceof Node ? view : defaultFallback(message, reset));
  }

  reset() {
    if (!this._failed) return;
    this._failed = false;
    // Re-clone the blueprint: the rebuilt subtree connects fresh and may throw
    // again (→ catch), or render cleanly if the cause is gone.
    this.replaceChildren(...this._blueprint.map((n) => n.cloneNode(true)));
  }
}

// Exported so `import { ErrorBoundary } from "@opentf/web"` resolves; the import
// side effect registers the element (JSX uses the `web-internal-error-boundary` tag).
export const ErrorBoundary = ErrorBoundaryElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-error-boundary")) {
  customElements.define("web-internal-error-boundary", ErrorBoundaryElement);
}
