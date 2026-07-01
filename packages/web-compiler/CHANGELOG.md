# @opentf/web-compiler

## [Unreleased]

## [0.2.0] - 2026-07-01

### Fixed

- Multiple components in one file no longer crash on first paint of a pre-rendered
  (SSR/SSG) page. Each component's `customElements.define` was emitted inline, right
  after its class, in source order — so a component declared before a sibling it renders
  (e.g. a `ThemeToggle` that composes a local `MonitorIcon` defined lower in the file)
  registered first. Defining a tag synchronously upgrades any matching server-rendered
  element and runs its `connectedCallback`, which reaches the sibling by `Sibling.tag`
  while that sibling's class is still in its temporal dead zone — a runtime `Cannot read
  properties of undefined (reading 'tag')`. A module now emits **every** component class
  first and **all** the `customElements.define` calls last, so any class is fully
  declared before a registration can upgrade an element that references it.
- `cond ? items.map((i) => <X/>) : <y/>` — a `.map` nested inside a conditional now
  lowers to a keyed `bindList` (like a top-level `.map`) instead of hoisting the item
  JSX out of the callback, which dropped the map parameter and produced a runtime
  `ReferenceError: i is not defined`. The item builder again keeps its parameter in
  scope.

### Changed

- MDX fenced code blocks now compile to the `CodeFence` built-in
  (`web-internal-code-block`) instead of an inert `RawHtml`, so the copy button carries
  its own behavior and works in any layout.

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
