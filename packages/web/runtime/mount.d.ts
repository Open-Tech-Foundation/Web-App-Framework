/** Build a factory view and attach its reactive scope to the node's teardown. */
export function buildScopedView(view: any): any;
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
export function mount(view: any, target: any): any;
/** Run a node's `onMount` callbacks, collecting returned disposers as cleanups. */
export function runMount(node: any): void;
/** Run a node's collected `onCleanup`/disposer teardown (idempotent). */
export function runCleanup(node: any): void;
