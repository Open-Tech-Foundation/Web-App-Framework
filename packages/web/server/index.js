// Server entry for SSG: the string-building helpers the compiler emits, the
// render/route API, and the built-in component SSG renderers (registered on
// import). Imported as "@opentf/web/server".

export * from "./ssg-runtime.js";
export * from "./head.js";
export * from "./render.js";
export * from "./api.js";
export { createMiddleware } from "./middleware.js";
export * from "./cookies.js";
export * from "./loader.js";
import "./builtins.js";
