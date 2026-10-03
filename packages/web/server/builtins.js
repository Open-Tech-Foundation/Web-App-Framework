//! SSG renderers for the built-in runtime components (the ones that are
//! hand-written Custom Elements, not compiled). Registered on import so the SSG
//! bundle can render `<Link>`, `<ContextProvider>`, `<Portal>`, `<ErrorBoundary>`.

import { attr, defineSSG } from "./ssg-runtime.js";
import { localizePath } from "../runtime/router.js";

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
const register = (tag, render) => {
  render.tag = tag;
  return defineSSG(tag, render);
};
const passthrough = (tag) => register(tag, (_props, children) => slot(tag, children));
// Match Link.jsx's static view without importing its browser registration barrel.
export const Link = register("web-link", (props, children) =>
  `<a${attr("href", localizePath(props.href))}${attr("class", props.class)}${attr("aria-label", props["aria-label"] || props.ariaLabel)}${attr("aria-current", props["aria-current"] || props.ariaCurrent)}>${slot("web-link", children)}</a>`);
Link.hostClass = "web-link";
// The provider has to carry its context token in the *served HTML*. Consumers are
// Custom Elements that upgrade the moment their definition is registered — which
// happens before the enclosing component's hydrate code runs and assigns the
// `context` prop. `readContext` resolves the provider with `closest()`, so if the
// attribute is not already in the markup at upgrade time, every consumer on the page
// silently binds to the context *default* and never sees a provided value again.
export const ContextProvider = passthrough("web-internal-context-provider");
ContextProvider.hostAttrs = (props) =>
  props && props.context && props.context.id ? ` data-otfw-ctx="${props.context.id}"` : "";
export const Portal = passthrough("web-internal-portal");
export const ErrorBoundary = passthrough("web-internal-error-boundary");
// RawHtml: emit the trusted HTML string inline (MDX highlighted code blocks).
export const RawHtml = register("web-internal-raw-html", (props) => (props && props.html != null ? String(props.html) : ""));
// CodeFence: same inline HTML as RawHtml; the copy button wires up on the client
// when the element upgrades (SSG output is static, the behavior is CSR-only).
export const CodeFence = register("web-internal-code-block", (props) => (props && props.html != null ? String(props.html) : ""));
