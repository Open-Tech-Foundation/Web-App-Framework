# @opentf/esdev-plugin-web

## [Unreleased]

### Added

- Initial release: OTF Web plugins for esdev's `runtime:build` bundler.
- **`otfwPlugin` / `createOtfwPlugin`** — compile `.jsx`/`.tsx` (and
  `.mdx`/`.md`) through the `otfwc` IR compiler (csr/ssg/hydrate targets,
  diagnostic stubs unless `failOnError`, per-module `onResult` reporting).
  The project-plugin factory resolves the compiler lazily, so `.jsx`
  sources load directly under `esdev test` with no precompile step.
- **Compiler service** — `resolveCompiler` (OTFWC_BIN, packaged prebuilt,
  Cargo workspace fallback; fully injectable), one persistent `otfwc serve`
  child per plugin instance (`startCompilerServer`, `closeCompilers`), and
  structured diagnostics (`compileError`).
- **`createOtfwRoutes`** — Next.js-style file conventions as a virtual
  `@otfw/routes` module (`{ pages, guard }`) crawled from `app/` with the
  runtime `Glob`.
- **`createCssPlugin`** — stylesheets: style inject, CSS Modules identity
  maps, and Tailwind v4 compilation (pure-JS engine + resolution shims,
  no native addons).
