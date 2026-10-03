// Server entry for SSG: the string-building helpers the compiler emits, the
// render/route API, and the built-in component SSG renderers (registered on
// import). Imported as "@opentf/web/server".

export * from "./ssg-runtime.js";
export * from "../core/signals.js";
export * from "../core/reactive.js";
export * from "../core/errors.js";
export * from "../core/context.js";
export * from "../runtime/lifecycle.js";
export { resource } from "../runtime/resource.js";
export { copyText, copyWithFeedback } from "../runtime/clipboard.js";
export { Link, ContextProvider, Portal, ErrorBoundary, RawHtml, CodeFence } from "./builtins.js";
export * from "./head.js";
export * from "./render.js";
// Share registration and request-scoped route state without loading Custom Elements.
export {
  registerRoutes, router, matchRoute, configureI18n, i18nLocales,
  resolveLocale, localizePath, shouldInterceptNav,
} from "../runtime/router.js";
export * from "./api.js";
export { createMiddleware } from "./middleware.js";
export * from "./cookies.js";
export * from "./loader.js";
import "./builtins.js";
