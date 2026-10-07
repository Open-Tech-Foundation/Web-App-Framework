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
// Server builds resolve a page's `@opentf/web` imports here, so the client APIs a
// page may call or reference must exist too: `setLocale`/`setRouteState` write the
// request's route state, `navigate` is a no-op without a mounted app.
export {
  registerRoutes, router, matchRoute, configureI18n, i18nLocales,
  resolveLocale, localizePath, shouldInterceptNav,
  setLocale, setRouteState, navigate,
} from "../runtime/router.js";
export { isHydrating } from "../runtime/hydrate.js";
export { emit } from "../runtime/events.js";
export * from "./api.js";
export { createMiddleware } from "./middleware.js";
export * from "./cookies.js";
export * from "./loader.js";
import "./builtins.js";
