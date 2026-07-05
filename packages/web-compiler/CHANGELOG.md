# @opentf/web-compiler

## [Unreleased]

## [0.4.0] - 2026-07-05

### Fixed

- A component that **builds during the hydration pass no longer cascades
  `HydrationMismatch`es through its child islands.** A view the hydrate backend can't adopt
  (`RebuildIfServerChildren` — e.g. one binding JSX to a local, `const body = <div/>`) tears
  down its server DOM and rebuilds via CSR on first paint. But that build ran while the
  global `isHydrating()` flag was still set, so every child Custom Element it `createElement`d
  — which upgrades *synchronously* on `appendChild` — took the *adopt* arm, trying to claim
  server markers in DOM the parent had just built from scratch. The first mismatch recovered
  by rebuilding, whose fresh children mismatched in turn: a rebuild cascade down every nested
  island (a single non-adoptable layout spammed dozens of `expected <a>, found <span>` errors
  and flashed the whole docs-site nav + sidebar, self-healing to correct DOM). Codegen now
  brackets every build path — `RebuildIfServerChildren`, and the dual `Adopt` view's `__build`
  recovery closure — in the new runtime `runBuild(() => …)`, which clears `isHydrating()` for
  the synchronous span of the build. The fresh subtree's islands build (matching the DOM
  they're handed) instead of adopting a phantom; on client navigation the flag is already
  clear, so it's a no-op. The build/adopt boundary is now correct regardless of which views
  are adoptable — a non-adoptable component degrades to a clean local rebuild, never a
  page-wide cascade (docs/HYDRATION.md §3.5).

- A hydrating component with a **`class` prop** no longer loses that prop to the host's
  styling-hook class. The prop shares the host's `class` attribute with the `web-<name>`
  hook, so a server-rendered host carries `class="web-<name>"`; on upgrade the Custom
  Elements spec fires `attributeChangedCallback("class", …)` for that pre-existing
  attribute *after* the constructor, overwriting the signal just initialized from the rich
  payload (e.g. a `<Link class="nav-link">` rendered its `<a class="web-link">`). The
  hydrate-target constructor now latches the same `_stampingHostClass` guard the runtime
  stamp uses, so the upgrade-time callback is ignored and the payload value stands.
- A component whose **root is a conditional** (e.g. `cond ? <a/> : <Link/>`) — or any
  multi-node/fragment root — now *adopts* its server DOM on hydration instead of falling
  back to a destroy-and-rebuild. Such a root lowers to a `Fragment`, which the adopt walk
  didn't handle ("fragment / multi-node root not supported"), so the component discarded
  its server subtree and rebuilt via CSR during first paint. That wiped the server DOM of
  any child islands nested in the branches (e.g. a `<Link>` → `<web-link>`), racing with
  their own adopt and emitting per-component `HydrationMismatch`es (a visible flash). The
  walk now flattens a fragment root, adopting each child off the host cursor — so a
  conditional root claims its rendered branch via `hydrateChild`. Fixes the navbar-link
  hydration flash on every page of the docs site.

## [0.3.0] - 2026-07-05

### Fixed

- `onMount` no longer crashes pre-rendered (`--ssg`) pages on hydration. The hydrate
  target factors a component's setup — and thus its local bindings — into a `__build`
  closure and re-emits it inside the adopt branch, two separate scopes. The `onMount`
  callbacks close over those locals, but were hoisted to the `connectedCallback` top
  level, after the build/adopt switch, where the locals don't exist — a runtime
  `ReferenceError` (e.g. `ready is not defined`) that broke every SSG page using
  `onMount`. The mount blocks are now emitted inside each scoped path (end of `__build`
  and end of the adopt try-block), preserving exactly-once semantics across the
  navigation, successful-adopt, and mismatch-recovery paths. CSR/`Build` output is
  unchanged (setup and mounts already share one scope).

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
