// `@opentf/esdev-plugin-web` — OTF Web plugins for esdev's `runtime:build`
// bundler (see https://esrun.opentechf.org/api/build).
//
// The `otfw` CLI (`@opentf/web-cli`) is the primary consumer; anything driving
// `runtime:build` over OTF sources — including a future esdev with OTF baked
// in — takes the same surface.

export { closeCompilers, compileError, resolveCompiler, startCompilerServer } from "./compiler.js";
export { createOtfwPlugin, otfwPlugin } from "./plugin.js";
export { createOtfwRoutes } from "./routes.js";
export { createCssPlugin } from "./css.js";
