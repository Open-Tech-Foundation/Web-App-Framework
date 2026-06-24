//! SSG renderers for the built-in runtime components (the ones that are
//! hand-written Custom Elements, not compiled). Registered on import so the SSG
//! bundle can render `<Link>`, `<ContextProvider>`, `<Portal>`, `<ErrorBoundary>`.

import { defineSSG } from "./ssg-runtime.js";

// (web-link is provided by the compiled components/Link.jsx, not hand-written.)
// Passthrough: their effect is structural/client-side; SSG renders children inline.
defineSSG("web-internal-context-provider", (_props, children) => children);
defineSSG("web-internal-portal", (_props, children) => children);
defineSSG("web-internal-error-boundary", (_props, children) => children);
// RawHtml: emit the trusted HTML string inline (MDX highlighted code blocks).
defineSSG("web-internal-raw-html", (props) => (props && props.html != null ? String(props.html) : ""));
// CodeFence: same inline HTML as RawHtml; the copy button wires up on the client
// when the element upgrades (SSG output is static, the behavior is CSR-only).
defineSSG("web-internal-code-block", (props) => (props && props.html != null ? String(props.html) : ""));
