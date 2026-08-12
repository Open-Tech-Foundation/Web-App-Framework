# @opentf/web-compiler

## [Unreleased]

### Added

- **Every compile diagnostic now says where** (`crates/otfw_cli/src/diagnostic.rs`). A failure
  used to be a bare sentence — `parse error: Unexpected token` — leaving the developer to find
  the spot by reading. Each diagnostic now carries the byte offset the compiler already knew
  about, rendered as `path:line:column` plus a code frame with a caret under the offending
  span: syntax errors (from the parser's own label), the `$state` in-place mutation rejection,
  the callback-`ref` rejection, and the "contains JSX but never returns it" near-miss. `otfwc
  build` prints that; `otfwc serve` replies with the same diagnostic as JSON
  (`{ file, message, line, column, frame, note }`) so the toolchain can put the position in its
  error overlay instead of re-parsing prose. A `.mdx`/`.md` module compiles through generated
  JSX, so its positions are labelled as such rather than pointed at the wrong Markdown line.

### Changed

- **The `serve` protocol's `ERR` frame carries JSON, not a prose message.** Only `@opentf/web-cli`
  speaks this protocol, and it pins an exact compiler version, so the two release together;
  a newer CLI still accepts the old plain-string payload (it simply has no position to show).

### Fixed

- **Static props on framework built-ins are no longer dropped by the hydrate walk**
  (`codegen/hydrate.rs`). The adopt walk deliberately skips re-applying a static component
  prop, because a compiled component recovers it in its generated constructor from the
  serialized island payload. Hand-written built-ins (`web-internal-*`, `web-link`) have no
  such constructor, so for them the prop was not deferred — it was lost. The visible case
  was `<ContextProvider context={Ctx} value="high-contrast">`, which published `undefined`
  to its entire subtree on every server-rendered page, silently disabling nested context
  overrides. Statics are now re-applied on built-in hosts; compiled components are
  unchanged.

## [0.16.0] - 2026-07-31

### Fixed

- **Server HTML now re-parses into the tree the hydrate walk was generated against.** The claim
  walk addresses nodes positionally, so it assumes what the SSG backend serialized is what the
  browser's parser hands back. Where it isn't, the walk threw a `HydrationMismatch` about a
  symptom (`expected <tr>, found <tbody>`) at whatever claim happened to land on the difference,
  and the route's server DOM was discarded and rebuilt. Two of these were wrong in the *served
  HTML* too, before any hydration:

  - **Raw text carries no markers.** `<textarea>`, `<title>`, `<style>` and `<script>` are
    RCDATA/raw text, so a `<!--$-->` written in them was served as those literal characters.
    Their content is emitted bare and escaped the way the tokenizer expects — escapable raw text
    escaped, `<script>`/`<style>` verbatim, so `a > b` in a stylesheet stays `a > b` — and the
    hole binds the element's own text node (`claimRawText`). Markup inside a raw-text element is
    now a compile error.
  - **The implied `<tbody>` is inserted in lowering.** A bare `<tr>` under `<table>` is wrapped in
    the section the parser would imply, in the shared lowering, so SSG, CSR and the claim walk all
    describe the same tree — a pure CSR build produced no `tbody` at all, leaving `table > tr`
    selectors matching on one path and not the other.
  - **Anything else the parser reshapes is refused up front.** `<p><div>`, an island inside a
    `<p>` (whose own view may open with a block element), `<a><a>`, `<form><form>`, a dynamic
    region directly inside `<table>`: `codegen::static_tree` already modelled these rules for the
    CSR template-clone path, and the hydrate backend now asks the same model
    (`reparse_hazard`). The view falls back to a clean client build and the compiler says which
    shape and why. The refusal is deliberately narrow — an `<a>` is closed only by another `<a>`,
    an `<li>` only by another `<li>`, so `<a>{children}</a>` (the `Link` component, and with it
    every nav) still adopts; only `<p>`, which any block-level tag ends, makes content the view
    cannot see through hazardous.

- **`otfwc serve` prints its non-fatal warnings.** The reply frame carries only the emitted code,
  so every diagnostic raised while compiling through the long-lived server process was dropped —
  which is why the known non-adoptable shapes (spread props, JSX-as-value) read as silent
  rebuilds. They go to stderr, which the toolchain inherits.

## [0.15.0] - 2026-07-31

### Fixed

- **MDX GFM tables now emit the `.otfw-table-wrap` scroll container** instead of a bare `<table>`.
  A table whose columns do not fit the prose width used to overflow the content column and run
  under the "On this page" TOC; it now scrolls inside its own box. The wrapper is `tabindex="0"`
  so the scroll area is keyboard reachable.

## [0.14.0] - 2026-07-30

### Performance

- **The CSR build path stamps static subtrees from a hoisted `<template>`** instead of emitting a
  `document.createElement` + `setAttribute` + `appendChild` for every node. This was the last
  large item in the generated module: the hydrate target carries the build path as its
  SPA-navigation/rebuild fallback, so a docs page paid for the whole document twice — once as the
  adopt walk, once as a per-node rebuild.

  For the 2.3 MB MDX page in [the SSG build benchmark](../../benchmarks/ssg-build/README.md) the
  emitted module drops from **19.8 MB to 5.1 MB** (343,286 → 33,773 lines), the shipped client
  chunk from **2.02 MB to 608 KB**, and `otfw build --ssg` from **5.0 s to 2.9 s** with peak
  memory down from 1245 MB to 712 MB. Rendered HTML is unchanged — `dist/` is byte-identical
  apart from content hashes.

  Cloning a template is only a legal rewrite where the HTML parser leaves markup alone, and it
  often does not: `template.innerHTML` re-parses, so `<p><div/></p>` becomes two siblings, a bare
  `<tr>` grows a `<tbody>`, and non-table content inside a table is foster-parented out in front
  of it — none of which `createElement` does. `codegen::static_tree::template_html` serializes a
  subtree only after proving the parser is a no-op on it, and anything else keeps the per-node
  build. `packages/web-cli/tests/e2e/template-parity.mjs` compiles each fixture *both* ways and
  requires the two DOM trees to be indistinguishable in headless Chromium; `OTFWC_NO_TEMPLATES=1`
  is the escape hatch if that analysis is ever wrong for some app's markup.

  **Requires `@opentf/web` ≥ 0.26.0**, which exports the `template` helper the emitted modules now
  import. A compiled module names it in its import header, so an app on this compiler with an
  older runtime fails at module load, not at render — these two must be released together.

- **MDX parsing is linear in page length again.** `mdx_to_jsx` was superlinear — a docs page cost
  ~3× more per doubling rather than 2× — and the cause was not in this crate: `markdown-rs`
  1.0.0's `EditMap::add` scans its pending-edit list on every call, and that list grows with the
  document. Parsing 8,000 GFM table rows took 13.7 s. `crates/otfw_markdown` is a fork of the
  crate carrying the one-function fix (see its `FORK.md`); the same parse now takes 213 ms, and
  `mdx_to_jsx` over a 74 KB → 2.4 MB ladder holds a flat 2× per doubling. Emitted JSX is
  byte-identical across the repo's 78 `.md`/`.mdx` files.

  Combined with the template change, the 2.3 MB page builds in **2.9 s instead of 16.1 s**.

### Fixed

- **The hydrate backend no longer walks into fully static subtrees.** Adopting a page emitted a
  `cursor` plus a `claimElement`/`skipNode` per node, all the way down — even through markup
  that cannot change. Claiming an element already advances the cursor past its whole subtree
  (the same reason a child component isn't walked into) and static attributes are already
  serialized in the server HTML, so for a static subtree the walk did a great deal of work to
  arrive back where it started. A static subtree now costs one `claimElement`.

  This is what made a large docs page's client module enormous. For a 2.3 MB MDX page the
  adopt path collapsed from ~72,000 emitted lines to ~2,950, cutting the module from 29.8 MB
  to 19.8 MB — and because the bundler's cost grows faster than linearly with input, the whole
  `otfw build --ssg` went from **53.9 s to 15.2 s** with peak memory down from 1461 MB to
  1170 MB. Rendered HTML is unchanged (byte-identical `dist/` apart from content hashes).

## [0.13.0] - 2026-07-30

### Fixed

- **SSG codegen folds adjacent static markup into single string literals**, instead of emitting
  one `+` term per fragment (`"<div" + ">" + "<h2" + ">"` → `"<div><h2>"`). A fully static
  subtree now collapses to one literal. Previously a page's whole view was one expression
  carrying a `+` per fragment — ~11k of them for a 1000-section docs page, ~16.5k for 1500 —
  and the deeply left-nested tree that produced is what the bundler choked on:

  - **`otfw build --ssg` crashed with SIGSEGV** on large pages, past roughly 13k terms
    (~90KB of markdown in one page), when the bundler's parser overflowed its stack. It
    could not be worked around with `ulimit -s`, since that parse runs off the main thread.
    A 468KB single-page build now completes in 573MB.
  - **Peak build memory grew ~quadratically with page size**, which made whole-site builds
    run out of memory: 40 docs pages totalling ~1MB of markdown peaked at **6.0GB**, now
    **700MB**. A single 1100-section page went from 1348MB to 312MB.

  Emitted SSG output is ~48% smaller for static-heavy pages. Rendered HTML is unchanged —
  byte-identical `dist/` output across a real 12-route, 62-file docs site.

## [0.12.0] - 2026-07-25

### Fixed

- **MDX no longer wraps block-level content in a `<p>`.** markdown-rs puts stacked JSX elements
  (four `<Callout/>` lines in a row) and raw HTML blocks into a single paragraph, and the `<p>`
  emitted around them is markup the browser **re-parses differently** — a `<p>` is closed by any
  block-level start tag, so the content gets hoisted out of it. The hydration walk then claimed
  the `<p>` and looked inside for children the parser had moved elsewhere
  (`HydrationMismatch: expected <h1>, found nothing`), which bails the **whole route** to a
  client-side rebuild — two docs pages rebuilt ~85% of their nodes, layout, navbar and sidebar
  included. A paragraph whose entire content is raw HTML and/or JSX elements now emits those
  blocks directly; a paragraph mixing prose with an inline element keeps its `<p>`.
- **A component's `{children}` slot markers now carry the owning host's tag** —
  `<!--c[web-card-8e61e2ff-->…<!--c]web-card-8e61e2ff-->` instead of bare `<!--c[-->`. Slot
  regions nest: a component that forwards `{children}` into another
  (`<Card>` → `<Link>{children}</Link>`) emits its markers *inside* that component's, and a
  forwarding parent adds a third pair at the same spot. Unlabeled, neither the component's own
  walk nor the composing parent could tell which pair was its own — the walk stopped at the
  first close it met and overran (`expected <span>, found comment <!--c]-->`), and the parent
  adopted its children against another component's region and lost them
  (`expected a children-slot marker, found <span>`). **Requires `@opentf/web` ≥ 0.23.0**, which
  reads the labels.
- **`const body = cond ? <a/> : <b/>` is now adoptable.** JSX-value-local support previously
  accepted only the bare `const NAME = <jsx>` shape, so the common layout idiom — including
  `@opentf/web-docs`' own `BlogLayout` — stayed on the rebuild fallback and discarded the server
  DOM (with the page content slotted into it) on first paint. A right-hand side that puts every
  JSX node in a *node position* (a bare node, `cond ? X : Y` with either branch nullish, or
  `cond && X`) is now emitted as a dual `{ build, adopt }` object whose templates keep the
  condition, so adoption selects the branch the server rendered. Non-positional shapes
  (`{ a: <A/> }`, `[<A/>, <B/>]`) still fall back.
- **A conditional region no longer steals the component's slotted children on first paint.** The
  region effect ran the *build* template once just to subscribe to the condition's dependencies
  and threw the result away — but when a branch re-slots `{children}`, `appendChild` **moves**
  those live server nodes into the discarded tree, silently emptying the slot. The generated code
  now passes a separate dependency-only closure (the same expression with every branch replaced
  by `null`), so the subscribe run touches no DOM.
- **A component that can't be adopted keeps the content slotted into it.** The rebuild fallback
  and the per-component mismatch recovery cleared the host and *then* captured `this.childNodes`
  as the call-site children — but on a server-rendered host those are the rendered view, so the
  capture came back empty and the parent's slotted content was destroyed rather than re-slotted.
  Both paths now recover the slot nodes from their markers first. A non-adoptable component
  still flashes, but nothing disappears.

## [0.11.0] - 2026-07-24

### Fixed

- **A JSX-value local containing a `{children}` slot no longer crashes hydration
  (`ReferenceError: __children is not defined`).** Phase 2.1e made
  `const body = <jsx>{children}</jsx>` adoptable, but the value local's CSR `build` fallback is
  emitted *inside* the component's adopt branch while the light-DOM children capture lived only
  in the sibling `__build` closure — so in the adopt scope the children local was a free
  variable. Any component whose value local slots its children (the real `DocsLayout`:
  `<article class="otfw-prose">{props.children}</article>`) threw out of `connectedCallback` on
  first paint, killing the render and leaving the rest of the page to mismatch. The adopt branch
  now declares the children local itself and seeds it from `skipSlot`'s return value.

  Seeding alone would have traded the crash for silent content loss: `hydrateChild` evaluates the
  build template once purely to subscribe to the branch expression's reactive deps and throws the
  result away, and a real rebuild there `appendChild`s the *live* slotted nodes into that
  discarded tree — emptying the slot. So the adopt walk now memoizes its root and the first
  `build()` after an adopt returns that node untouched; only a genuine later swap builds fresh.
  (Requires `@opentf/web` ≥ 0.21.0, where `skipSlot` returns the slotted nodes.)

## [0.10.0] - 2026-07-18

### Fixed

- **JSX-value locals now hydrate in place instead of forcing a rebuild (Phase 2.1e).** The
  `otfwc` hydrate backend could not adopt a layout/component that binds JSX to a local and
  renders it — `const body = <div/>; return frame ? <shell>{body}</shell> : body` (the
  `DocsLayout` idiom) — so the whole view fell to `RebuildIfServerChildren`, discarding the
  server DOM on first paint (a content flash) and cascading `HydrationMismatch`es through
  nested islands. It now emits such a local as a dual `{ build, adopt }` object: a `{body}`
  hole adopts the server subtree in place (via `@opentf/web`'s new `hydrateHole`) and a
  bare-identifier dynamic-node branch adopts off the region cursor. Only the bare
  `const NAME = <jsx>` shape is adopted; a JSX value inside an object/array/ternary stays on
  the safe rebuild fallback. (Requires `@opentf/web` ≥ 0.19.0 for the `hydrateHole` runtime
  helper.)

## [0.9.0] - 2026-07-08

### Fixed

- **JSX written inside a loop or callback body captures that scope's locals.** JSX
  embedded in a plain statement (`groups.push(<Child group={group}/>)` inside a `for`
  body, a JSX-valued prop or list source with an embedded callback) compiled to a
  builder function hoisted to the component body, so its generated effects and handlers
  referenced loop locals that didn't exist there — throwing
  `ReferenceError: group is not defined` at runtime. The generated builder is now
  emitted inline at the exact spot the JSX was written, so it evaluates in the scope
  the developer wrote it in. Dev-written statements and variables are unchanged.
- **JSX inside a `$effect` callback compiles.** A `$effect` body embedding JSX (e.g. a
  `for` loop pushing `<Child/>` nodes, then `container.replaceChildren(...nodes)`) was
  never probed for JSX, so the raw JSX leaked verbatim into the compiled module and
  broke the build. Effect callbacks are now templated like any other statement, with
  embedded elements built inline and the callback's locals captured correctly.
- **JSX inside `$expose` and the lifecycle hooks compiles.** The same gap existed in
  `onMount`, `onCleanup`, `onResize`, `onVisibilityChange`, `onMediaQuery`, and the
  `$expose` object — all now share the `$effect` treatment, including pulling in the
  runtime helpers (`setProp`/`effect`) their generated builders need.

## [0.8.0] - 2026-07-07

### Fixed

- **A list `key={index}` reads the real index binding instead of `undefined`.** For
  `arr.map((item, index) => <li key={index}>…)`, the generated key function bound a
  synthetic `_index` parameter while the key expression still referenced `index`, so keyed
  reconciliation evaluated the key against an undefined variable. The key function now binds
  the callback's actual item/index names across the CSR and hydrate backends.
- **JSX in a list's data expression compiles to a real node instead of falling through to
  a host `jsx-runtime`.** A JSX value inside the array a list maps over
  (`[{ icon: <b/> }].map(t => <li>{t.icon}</li>)`) was emitted verbatim, so `<b/>` became a
  `jsx-runtime` element object that the item's text hole stringified to `[object Object]`.
  The list source is now templated like a JSX-valued prop — each embedded element builds a
  real DOM node (CSR / hydrate) or an `{ __html }` marker (SSG). Previously only hoisting the
  array to a `const` worked; inline data now compiles correctly across all backends.

## [0.7.0] - 2026-07-07

### Fixed

- **Valueless boolean props on components pass `true`, not `""`.** A valueless prop on a
  component (`<Toggle disabled/>`) was lowered to an empty-string static, so the component
  read a falsy `""` instead of the expected boolean. It now crosses as the JS boolean `true`
  across all backends (CSR `setProp(el, "disabled", true)`, SSG payload `{ disabled: true }`,
  and hydration reads it from that payload). DOM elements are unchanged — a valueless
  attribute (`<input disabled/>`) stays the empty-string presence attribute.

## [0.6.0] - 2026-07-06

### Added

- **DOM lifecycle hooks**: `onResize(cb)`, `onVisibilityChange(cb)`, and
  `onMediaQuery(query, cb)` compile like `onMount`/`onCleanup` — the compiler wires a
  `ResizeObserver` / `IntersectionObserver` on the component's host element (a page's
  root element) or a `matchMedia` listener, with automatic teardown on
  disconnect/navigation. `onMediaQuery` delivers the initial match state synchronously at
  mount. In a page/layout, `onResize`/`onVisibilityChange` require a single element root.

## [0.5.0] - 2026-07-05

### Fixed

- **`.map()` callback locals are preserved.** A local declared before the returned JSX in a
  block-body callback (`items.map((x) => { const h = …; return <li style={…}/>; })`) no longer
  throws `ReferenceError` at runtime — it is re-emitted inside the generated item builder.
- **Function-expression `.map()` callbacks** (`items.map(function (item, i) { return <…/>; })`)
  compile like arrow callbacks, with `item`/`i` in scope, instead of dropping them.
- **Object-literal shorthand of a signal** compiles correctly: `{ count }` → `{ count: count.value }`
  instead of the invalid `{ count.value }` (previously a build-time parse error).
- **Named component exports from a `.jsx` module** resolve. A utility module can export several
  components (`export function Icon…`) and a consumer's `import { Icon }` / `<Icon/>` now works
  (previously `MISSING_EXPORT`).

### Changed

- **Function-valued (callback) refs are rejected with an actionable error.** `ref` takes a
  `$ref` signal; a `ref={(el) => …}` used to miscompile to invalid code. It now fails the build
  with guidance toward `$ref` + `$effect`/`onMount`/`onCleanup` (or `$expose`).
- A component that builds JSX imperatively and returns a non-JSX value (`parts.push(<li/>)` in a
  loop, `return parts`) now gets a clear diagnostic pointing at `.map()`/fragments instead of the
  cryptic "no component found".

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
