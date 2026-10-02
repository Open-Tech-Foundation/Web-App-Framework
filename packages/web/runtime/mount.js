// Mounting a factory-style view (pages/layouts compile to factory functions;
// SPEC §2.2). Components compile to Custom Elements and mount via the DOM.

import { reportError } from "../core/errors.js";
import { scope } from "../core/signals.js";

// Keep partial builds owned too: scope() only returns a disposer when its
// callback finishes, so capture an error until we can dispose and rethrow it.
function ownedScope(fn) {
  let failed = false, failure;
  const owned = scope(() => {
    try { return fn(); }
    catch (error) { failed = true; failure = error; }
  });
  if (failed) {
    try { owned.dispose(); } catch (error) { console.error(error); }
    throw failure;
  }
  return owned;
}

/** Build a factory view and attach its reactive scope to the node's teardown. */
export function buildScopedView(view) {
  const owned = ownedScope(view);
  const node = owned.result;
  try {
    const lc = (node.__lifecycle ??= { mounts: [], cleanups: [] });
    lc.cleanups.push(owned.dispose);
    return node;
  } catch (error) {
    try { owned.dispose(); } catch (cleanupError) { console.error(cleanupError); }
    throw error;
  }
}

/**
 * Mount a view into `target`. `view` is either a factory function returning a
 * DOM node or an already-built node. Returns the mounted node.
 *
 * Page/layout factories may attach a `__lifecycle` record (`{ mounts, cleanups }`)
 * built from `onMount`/`onCleanup`. After insertion we run the `onMount` callbacks,
 * collecting any returned disposer into `cleanups` so a caller (e.g. the router)
 * can tear the page down on navigation.
 *
 * A factory build runs inside a reactive `scope`, and the scope's disposer joins
 * the cleanups: teardown (router navigation) stops every binding effect the page
 * created, so a replaced page's subscriptions don't outlive it.
 */
export function mount(view, target) {
  const node = typeof view === "function" ? buildScopedView(view) : view;
  target.appendChild(node);
  runMount(node);
  return node;
}

/** Run a node's `onMount` callbacks, collecting returned disposers as cleanups. */
export function runMount(node) {
  const lc = node && node.__lifecycle;
  if (!lc) return;
  for (const cb of lc.mounts) {
    try {
      const owned = ownedScope(cb);
      lc.cleanups.push(owned.dispose);
      const disposer = owned.result;
      if (typeof disposer === "function") lc.cleanups.push(disposer);
    } catch (e) {
      reportError(e, { phase: "mount" });
    }
  }
  lc.mounts = [];
}

/** Run a node's collected `onCleanup`/disposer teardown (idempotent). */
export function runCleanup(node) {
  const lc = node && node.__lifecycle;
  if (!lc) return;
  for (const cb of lc.cleanups) {
    try {
      cb();
    } catch (e) {
      console.error(e);
    }
  }
  lc.cleanups = [];
}
