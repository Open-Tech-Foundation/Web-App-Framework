// `@opentf/esdev-plugin-web` — OTF Web plugins for esdev's `runtime:build`
// bundler (see https://esrun.opentechf.org/api/build).
//
// esdev create starters can name this package directly in esdev.json's
// top-level plugins. Programmatic build drivers use the named factories.

export { closeCompilers, compileError, resolveCompiler, startCompilerServer } from "./compiler.js";
export { createOtfwPlugin, otfwPlugin } from "./plugin.js";
export { createOtfwRoutes } from "./routes.js";
export { default, createWebPlugin } from "./web.js";
