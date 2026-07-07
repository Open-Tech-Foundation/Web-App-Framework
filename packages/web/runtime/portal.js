//! Portal — render a subtree into a different DOM location (a modal/tooltip/toast
//! escaping an ancestor's overflow/z-index/transform).
//
//   <Portal to="#toast-root"> … </Portal>   // selector, element, or default body
//
// `<Portal>` compiles to this built-in `web-internal-portal` element (capitalized name →
// tag, like <ContextProvider>) — no compiler changes. At connect it moves its
// light-DOM children to the target; on disconnect it removes them so their
// custom-element disconnect + effect cleanups run (the part userland leaks).
//
// Context is preserved across the boundary: each relocated root is marked
// `data-otfw-portal` with a `__portalHost` back-pointer to this element, and
// `readContext` (context.js) hops across it. Note that for modals/dialogs the
// native top layer (`<dialog>.showModal()`, the popover API) is usually a better
// fit than a portal — Portal is the general escape hatch for everything else.

import { afterHydration } from "./hydrate.js";

function resolveTarget(to) {
  if (to && to.nodeType === 1) return to; // an element
  if (typeof to === "string" && to) return document.querySelector(to) || document.body;
  return document.body;
}

export class PortalElement extends HTMLElement {
  set to(v) {
    this._to = v;
  }
  get to() {
    return this._to;
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    // During first-paint hydration the portal upgrades *before* the owning component adopts
    // its slotted children (the portal is defined eagerly by the runtime; the parent is a
    // route-chunk component). Relocating now would move the children out of the portal host
    // before the parent's `hydrateSlot` walk can wire them, leaving the portaled content
    // unhydrated. So defer the move until hydration finishes; on a CSR build (not hydrating)
    // `afterHydration` runs it synchronously, exactly as before.
    afterHydration(() => this._relocate());
  }

  _relocate() {
    if (!this._mounted || this._moved) return; // disconnected before flush, or already moved
    const target = resolveTarget(this._to);
    // Snapshot children, mark each element root for the context hop, then move
    // them — markers must be set before the move connects them at the target.
    this._moved = Array.from(this.childNodes);
    for (const n of this._moved) {
      if (n.nodeType === 1) {
        n.__portalHost = this;
        n.setAttribute("data-otfw-portal", "");
      }
    }
    for (const n of this._moved) target.appendChild(n);
  }

  disconnectedCallback() {
    for (const n of this._moved || []) n.remove(); // triggers descendants' cleanup
    // Reset to null, not []: `_relocate` treats a non-null `_moved` as "already relocated"
    // (so a stale queued callback can't move twice), and a re-mount must be free to relocate.
    this._moved = null;
    this._mounted = false;
  }
}

// Exported so `import { Portal } from "@opentf/web"` resolves; the import side
// effect registers the element (JSX uses the `web-internal-portal` tag).
export const Portal = PortalElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-portal")) {
  customElements.define("web-internal-portal", PortalElement);
}
