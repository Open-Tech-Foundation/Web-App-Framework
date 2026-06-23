// Build-time entry for the docs toolchain integration.
//
// Re-exports the Rolldown nav plugin (registered by @opentf/web-cli when a project
// has a `docs` config) and the Pagefind post-build hook (Phase 2). Importing this
// from web-cli keeps all docs-specific build logic owned by this package.

export { docsNavPlugin } from "./docs-nav-plugin.js";
export { indexWithPagefind } from "./pagefind.js";
