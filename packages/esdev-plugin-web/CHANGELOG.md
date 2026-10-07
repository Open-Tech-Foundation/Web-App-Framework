# @opentf/esdev-plugin-web

## [Unreleased]

### Changed

- Development refresh of a page or layout keeps its `$state` and leaves outer
  layouts and the inner page in place (with the matching `@opentf/web` and
  `@opentf/web-compiler`). The README describes the new behavior.

## [0.4.0] - 2026-10-06

### Changed

- Requires esdev `>=0.16.0`, which fixes production route chunks importing an
  unhashed `entry.js`.

### Fixed

- Resolve framework imports in shared JavaScript/TypeScript modules to the DOM-free server entry for server targets; browser and explicit CSR/hydration targets keep the browser entry.

## [0.3.0] - 2026-10-03

### Added

- Export discovered loader route patterns as `loaderRoutes` from `@otfw/routes`, without bundling server loader modules in the browser.

- Request component/page refresh output for hot browser CSR builds through esdev's
  existing HMR API. Release, server and test output stays free of refresh code.
- Local-package Chromium regressions cover compatible state, cleanup, refs,
  slotted/co-located children, route refresh and reload fallbacks.

### Changed

- Require esdev `>=0.15.0` for the compiler package resolver used by bundled
  prerender entries and isolated package installations.

### Fixed

- Route discovery rejects unsupported Markdown/MDX 404 files with a clear error
  instead of registering them as homepage routes.

## [0.2.0] - 2026-10-01

### Added

- Compiler transforms now return source maps to esdev for original JSX/TSX
  expressions, statements, and callbacks. Esdev handles final bundle composition.
- Optional mapped compiler-service responses, preserving plain JavaScript service
  callers and compatibility with binaries that predate source-map output.
- Source-map tests cover CSR/SSG/hydrate, Unicode columns, inline CLI maps, and
  esdev remapping an error in a dynamically imported bundle to the original JSX.

- Default `createWebPlugin` factory combines JSX compilation and `@otfw/routes`
  for native esdev starter configs without an explicit export name.
- `mode: "spa" | "ssg" | "ssr"` chooses CSR, server rendering, or hydration
  using esdev's command/platform hook context. Explicit compiler targets remain
  supported. The default starter factory fails on compiler errors.
- Standalone starter integration verifies published package files, browser and
  server build targets, and execution of a stateful server-rendered route.

- Initial release: OTF Web plugins for esdev's `runtime:build` bundler.
- **`otfwPlugin` / `createOtfwPlugin`** — compile `.jsx`/`.tsx` (and
  `.mdx`/`.md`) through the `otfwc` IR compiler (csr/ssg/hydrate targets,
  diagnostic stubs unless `failOnError`, per-module `onResult` reporting).
  The project-plugin factory resolves the compiler lazily. In esdev 0.14+,
  top-level project plugins also compile unbundled test and script imports;
  JSX tests need no precompile step.
- **Compiler service** — `resolveCompiler` (OTFWC_BIN, packaged prebuilt,
  Cargo workspace fallback; fully injectable), one persistent `otfwc serve`
  child per plugin instance (`startCompilerServer`, `closeCompilers`), and
  structured diagnostics (`compileError`).
- **`createOtfwRoutes`** — Next.js-style file conventions as a virtual
  `@otfw/routes` module (`{ pages, guard }`) crawled from `app/` with the
  runtime `Glob`.
