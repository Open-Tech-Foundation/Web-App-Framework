// Test-only entry for `@opentf/web` (`@opentf/web/test`).
//
// The package root (`index.js`) ships `components/Link.jsx` as *source* for the
// consuming app's pipeline to compile — but `esdev test` runs files unaltered
// (no otfwc transform), so importing the root under esdev fails on the raw JSX.
// This barrel mirrors the root's `.js` surface verbatim and takes `Link` from
// its precompiled module instead (`components/Link.compiled.js`, emitted by
// `scripts/compile-test-fixtures.mjs`, git-ignored).
//
// Rules: test files and compiled fixtures import this, never the root. Shipped
// library code keeps importing the root (the real pipeline compiles it there).
// Requires the `--dom` realm — the runtime barrels reference `HTMLElement` at
// import time, exactly as the happy-dom suite did before.
export * from "./core/signals.js";
export * from "./core/reactive.js";
export * from "./core/errors.js";
export * from "./runtime/index.js";
export { default as Link } from "./components/Link.compiled.js";
