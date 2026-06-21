//! SSG renderers for the built-in runtime components (the ones that are
//! hand-written Custom Elements, not compiled). Registered on import so the SSG
//! bundle can render `<Link>`, `<ContextProvider>`, `<Portal>`, `<ErrorBoundary>`.

import { defineSSG, escapeAttr } from "./ssg-runtime.js";

// <Link href> → <web-link href><a href>children</a></web-link> (matches CSR).
defineSSG("web-link", (props, children) => {
  const href = props.href ?? "#";
  const cls = props.class ?? props.className ?? "";
  return `<a href="${escapeAttr(String(href))}"${cls ? ` class="${escapeAttr(String(cls))}"` : ""}>${children}</a>`;
});

// Passthrough: their effect is structural/client-side; SSG renders children inline.
defineSSG("web-context-provider", (_props, children) => children);
defineSSG("web-portal", (_props, children) => children);
defineSSG("web-error-boundary", (_props, children) => children);
