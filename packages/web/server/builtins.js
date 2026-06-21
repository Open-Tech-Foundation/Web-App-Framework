//! SSG renderers for the built-in runtime components (the ones that are
//! hand-written Custom Elements, not compiled). Registered on import so the SSG
//! bundle can render `<Link>`, `<ContextProvider>`, `<Portal>`, `<ErrorBoundary>`.

import { defineSSG } from "./ssg-runtime.js";

// (web-link is provided by the compiled components/Link.jsx, not hand-written.)
// Passthrough: their effect is structural/client-side; SSG renders children inline.
defineSSG("web-context-provider", (_props, children) => children);
defineSSG("web-portal", (_props, children) => children);
defineSSG("web-error-boundary", (_props, children) => children);
