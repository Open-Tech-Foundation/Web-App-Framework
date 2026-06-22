// Built-in custom elements self-register on import. They're used in JSX as *tags*
// (`<Portal>` → `web-portal`), so their bindings are never referenced and a plain
// re-export would be tree-shaken away (the element never registers). Bare imports
// force the registration side effect to be retained.
import "./context.js";
import "./error-boundary.js";
import "./portal.js";
import "./raw-html.js";

export * from "./dom.js";
export * from "./events.js";
export * from "./mount.js";
export * from "./lifecycle.js";
export * from "./router.js";
export * from "./context.js";
export * from "./error-boundary.js";
export * from "./portal.js";
export * from "./raw-html.js";
