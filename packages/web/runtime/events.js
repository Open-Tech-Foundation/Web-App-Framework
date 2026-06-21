//! Events — the dispatch half of the hybrid event model.
//
// Two channels (SPEC §5.4):
//   • callback props  — `<Picker onSelect={fn}>` sets a property; the component
//     calls `this.onSelect?.(detail)`. Direct parent→child, no bubbling.
//   • event listeners — `<Picker onSelect:listen={fn}>` compiles to
//     `addEventListener("select", fn, opts)` (with `:capture`/`:passive`/`:once`),
//     for bubbling/interop/multiple subscribers. `emit` is the matching dispatch.
//
// `emit(el, "select", detail)` fires a CustomEvent that bubbles and crosses shadow
// boundaries by default, so a `web-*` element is a first-class event source for any
// framework consuming it. Returns false if a listener called preventDefault().

export function emit(el, name, detail, options = {}) {
  const { bubbles = true, composed = true, cancelable = false } = options;
  return el.dispatchEvent(new CustomEvent(name, { detail, bubbles, composed, cancelable }));
}
