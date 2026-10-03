//! Context API — scoped dependency injection over the component tree.
//
// Unlike a module-level signal (which is global) or a prop (which must be drilled),
// context provides a value to a *subtree* and lets a nested provider override it.
// Because components compile to Custom Elements, the component tree *is* the DOM
// tree, so we resolve a consumer's provider with `closest()` — no special graph.
//
//   const ThemeContext = createContext("dark");
//   <ContextProvider context={ThemeContext} value={theme}> … </ContextProvider>
//   const theme = $context(ThemeContext);   // compiler macro; use the bare name
//
// `value` flows through the provider's element as a signal, so a reactive `value`
// (e.g. backed by `$state`) updates every consumer fine-grained.

import { signal } from "../core/signals.js";

export { createContext, readContext, enterHost, exitHost, getCurrentInstance } from "../core/context.js";

// `<ContextProvider context={Ctx} value={v}>`: a host element that publishes `v`
// (as a signal) for `Ctx` to its subtree. `context`/`value` arrive as element
// properties (the compiler sets component props reactively), so a changing `value`
// propagates to consumers automatically.
export class ContextProviderElement extends HTMLElement {
  constructor() {
    super();
    this._signal = signal(undefined);
  }
  set context(ctx) {
    if (ctx && ctx.id) this.setAttribute("data-otfw-ctx", ctx.id);
  }
  set value(v) {
    this._signal.value = v;
  }
  get value() {
    return this._signal.value;
  }
}

// Exported so `import { ContextProvider } from "@opentf/web"` resolves; the import
// side effect registers the element (JSX uses the `web-internal-context-provider` tag).
export const ContextProvider = ContextProviderElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-context-provider")) {
  customElements.define("web-internal-context-provider", ContextProviderElement);
}
