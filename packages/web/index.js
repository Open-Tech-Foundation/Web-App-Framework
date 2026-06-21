// Public entry for the OpenTF Web runtime: reactivity + DOM operations.
// CSR-generated modules import their helpers (signal/computed/bindText/…) from here.
export * from "./core/signals.js";
export * from "./core/errors.js";
export * from "./runtime/index.js";
// `Link` is shipped as JSX source and compiled by the consuming app's pipeline
// (the `.jsx` lands in the module graph and otfwc transforms it). Its compiled
// module self-registers `web-link` (CSR `customElements.define` / SSG `defineSSG`).
export { default as Link } from "./components/Link.jsx";
