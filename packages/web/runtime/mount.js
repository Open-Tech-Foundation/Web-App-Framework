// Mounting a factory-style view (pages/layouts compile to factory functions;
// SPEC §2.2). Components compile to Custom Elements and mount via the DOM.

/**
 * Mount a view into `target`. `view` is either a factory function returning a
 * DOM node or an already-built node. Returns the mounted node.
 *
 * Page/layout factories may attach a `__lifecycle` record (`{ mounts, cleanups }`)
 * built from `onMount`/`onCleanup`. After insertion we run the `onMount` callbacks,
 * collecting any returned disposer into `cleanups` so a caller (e.g. the router)
 * can tear the page down on navigation.
 */
export function mount(view, target) {
  const node = typeof view === "function" ? view() : view;
  target.appendChild(node);
  runMount(node);
  return node;
}

/** Run a node's `onMount` callbacks, collecting returned disposers as cleanups. */
export function runMount(node) {
  const lc = node && node.__lifecycle;
  if (!lc) return;
  for (const cb of lc.mounts) {
    const disposer = cb();
    if (typeof disposer === "function") lc.cleanups.push(disposer);
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
