// Mounting a factory-style view (pages/layouts compile to factory functions;
// SPEC §2.2). Components compile to Custom Elements and mount via the DOM.

/**
 * Mount a view into `target`. `view` is either a factory function returning a
 * DOM node or an already-built node. Returns the mounted node.
 */
export function mount(view, target) {
  const node = typeof view === "function" ? view() : view;
  target.appendChild(node);
  return node;
}
