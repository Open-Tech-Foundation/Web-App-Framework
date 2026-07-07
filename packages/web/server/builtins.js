//! SSG renderers for the built-in runtime components (the ones that are
//! hand-written Custom Elements, not compiled). Registered on import so the SSG
//! bundle can render `<Link>`, `<ContextProvider>`, `<Portal>`, `<ErrorBoundary>`.

import { defineSSG } from "./ssg-runtime.js";

// (web-link is provided by the compiled components/Link.jsx, not hand-written.)
// Passthrough: their effect is structural/client-side; SSG renders children inline.
//
// The children are a `{children}` slot the compiler adopts on hydration via `hydrateSlot`,
// which locates the slotted content by the `<!--c[-->…<!--c]-->` markers (hydrate.js
// SLOT_START/SLOT_END) — the same markers the compiler emits around `{children}` in a normal
// component's SSG view. These hand-written renderers must emit them too, or the slotted
// content never gets its reactivity wired on first paint (dead bindings until a CSR rebuild).
const slot = (children) => `<!--c[-->${children ?? ""}<!--c]-->`;
defineSSG("web-internal-context-provider", (_props, children) => slot(children));
defineSSG("web-internal-portal", (_props, children) => slot(children));
defineSSG("web-internal-error-boundary", (_props, children) => slot(children));
// RawHtml: emit the trusted HTML string inline (MDX highlighted code blocks).
defineSSG("web-internal-raw-html", (props) => (props && props.html != null ? String(props.html) : ""));
// CodeFence: same inline HTML as RawHtml; the copy button wires up on the client
// when the element upgrades (SSG output is static, the behavior is CSR-only).
defineSSG("web-internal-code-block", (props) => (props && props.html != null ? String(props.html) : ""));
