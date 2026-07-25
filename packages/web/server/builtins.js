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
// The markers carry the host's own tag, exactly as the compiled components' do — slot
// regions nest, and the label is what lets each side find its own pair (see ssg.rs).
const slot = (tag, children) => `<!--c[${tag}-->${children ?? ""}<!--c]${tag}-->`;
const passthrough = (tag) => defineSSG(tag, (_props, children) => slot(tag, children));
passthrough("web-internal-context-provider");
passthrough("web-internal-portal");
passthrough("web-internal-error-boundary");
// RawHtml: emit the trusted HTML string inline (MDX highlighted code blocks).
defineSSG("web-internal-raw-html", (props) => (props && props.html != null ? String(props.html) : ""));
// CodeFence: same inline HTML as RawHtml; the copy button wires up on the client
// when the element upgrades (SSG output is static, the behavior is CSR-only).
defineSSG("web-internal-code-block", (props) => (props && props.html != null ? String(props.html) : ""));
