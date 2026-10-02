// Server entry for SSG: the string-building helpers the compiler emits, the
// render/route API, and the built-in component SSG renderers (registered on
// import). Imported as "@opentf/web/server".

export * from "./ssg-runtime.js";
export * from "./head.js";
export * from "./render.js";
// Share registration and request-scoped route state without loading Custom Elements.
export {
  registerRoutes, router, matchRoute, configureI18n, i18nLocales,
  resolveLocale, localizePath,
} from "../runtime/router.js";
export * from "./api.js";
export { createMiddleware } from "./middleware.js";
export * from "./cookies.js";
export * from "./loader.js";
import "./builtins.js";
