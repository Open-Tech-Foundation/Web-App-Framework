# @opentf/web-compiler

## [Unreleased]

### Added

- Module graph (ARCHITECTURE.md §5.2): a crawl of the app's modules — nodes =
  resolved files, edges = static and dynamic (`import()`) dependencies — with a
  content fingerprint per node. It answers a route's transitive dependency subgraph
  (the unit to compile on demand, stopping at lazy `import()` boundaries) and a
  changed file's transitive dependents (the precise rebuild set). Exposed as
  `otfwc graph [--web=<path>] <entry...>`, which prints it as JSON for the
  orchestrator to consume. Foundation for lazy route compilation and precise HMR;
  not yet wired into the dev server.
- `otfwc serve`: a long-lived compiler mode. It reads framed requests on stdin
  (`<id_len> <source_len> <component> <ssg>\n` + id bytes + source bytes) and writes
  `OK <len>\n<code>` / `ERR <len>\n<message>` replies on stdout, staying up across
  requests (and across compile errors). Lets the toolchain compile every module
  through one process instead of spawning `otfwc build` per file.

### Fixed

- Component DOM no longer accumulates on client-side re-navigation. A component's
  `disconnectedCallback` teardown disposed effects and reset `_mounted` but left the
  previously-built subtree in place; when the same element instance was re-inserted
  across client navigations — e.g. module-level JSX held in a `const`, such as a
  `<CodeBlock>` inside an MDX-exported `Tabs` config — `connectedCallback` rebuilt and
  appended over the stale subtree, duplicating the content once per visit. Teardown now
  clears the host (`this.replaceChildren()`) after the `_pendingTeardown` guard, so a
  reused instance remounts clean; a same-task DOM move still short-circuits (`_mounted`
  stays set) and never clears.

## 0.1.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
