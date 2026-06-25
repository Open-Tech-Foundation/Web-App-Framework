// Fallback for `@opentf/web-docs/nav`.
//
// When `docsNavPlugin` is active (the toolchain registers it whenever the project
// has a `docs` config), it intercepts this specifier and replaces it with a
// build-time-generated module exporting the real navigation. This file is only loaded
// when the plugin is NOT active (e.g. an editor, or a non-docs build).
//
// Shape: a section map `{ [base]: tree }` (e.g. `{ "/docs": [...], "/api": [...] }`);
// empty here.

if (typeof console !== "undefined") {
  console.warn(
    "[@opentf/web-docs] navigation requested but docsNavPlugin is not active — " +
      "did you add a `docs` block to otfw.config.js? Returning an empty nav.",
  );
}

export default {};
