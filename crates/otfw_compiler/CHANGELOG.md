# otfw_compiler

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Fixed

- **MDX no longer wraps block-level content in a `<p>` (`mdx.rs`).** markdown-rs puts stacked
  JSX elements (four `<Callout/>` lines in a row) and raw HTML blocks in one Paragraph, and the
  emitted `<p>` around them is markup the browser **re-parses differently** — the parser closes
  an open `<p>` at any block-level start tag, hoisting the content out. The hydration walk then
  claims the `<p>` and looks inside it for children that now live elsewhere
  (`expected <h1>, found nothing`), desyncing the cursor and bailing the *whole route* to a CSR
  rebuild: on the docs site two pages rebuilt ~85% of their nodes, layout, navbar and sidebar
  included. A paragraph whose entire content is raw HTML and/or JSX elements now emits those
  blocks directly (whitespace separators dropped); a paragraph mixing prose with an inline
  element keeps its `<p>`.
- **A component's `{children}` slot markers now carry the owning host's tag (`codegen/ssg.rs`).**
  `<!--c[web-card-8e61e2ff-->…<!--c]web-card-8e61e2ff-->` instead of bare `<!--c[-->`. Slot
  regions nest — a component that forwards `{children}` into another
  (`Card` → `<Link>{children}</Link>`) emits its markers *inside* that component's, and a
  forwarding parent adds a third pair at the same position — and unlabeled, neither the
  component's own walk nor the parent's `hydrateSlot` could identify its own pair. See
  `@opentf/web` for the matching runtime change.
- **`const body = cond ? <a/> : <b/>` is now adoptable (`codegen/hydrate.rs`).** The JSX-value
  local support added in 2.1e only accepted the bare `const NAME = <jsx>` shape, so the
  extremely common layout idiom — `web-docs`' own `BlogLayout` — stayed on
  `RebuildIfServerChildren` and threw away the server DOM (with the slotted page content in it)
  on first paint. A right-hand side that puts every JSX node in a **node position** (a bare
  node, `cond ? X : Y` with either branch nullish, or `cond && X`) is now emitted as a dual
  `{ build, adopt }` object whose templates keep the condition, so the adopt walk selects the
  same branch the server rendered. Non-positional shapes (`{ a: <A/> }`, `[<A/>, <B/>]`) still
  fall back.
- **`hydrateChild` no longer steals a component's slotted children (`codegen/hydrate.rs`).**
  Its region effect ran the *build* template once on first paint purely to subscribe to the
  condition's deps and discarded the result — but when a branch re-slots `{children}`,
  `appendChild` **moves** those live server nodes into the throwaway tree, silently emptying
  the slot (`<Card>` lost its children this way). Codegen now emits a third closure, the same
  expression with every branch replaced by `null`, and `hydrateChild` subscribes with that:
  same reads, no DOM. This also retires the adopted-root memo the value-local emitter needed to
  survive the spurious call.
- **A rebuilt component keeps the content that was slotted into it (`codegen/csr.rs`).** The
  `RebuildIfServerChildren` fallback and the per-component mismatch recovery cleared the host
  and *then* captured `this.childNodes` as the call-site children — which on a server-rendered
  host is the rendered view, so the capture came back empty and the parent's slotted content
  was destroyed rather than re-slotted. Both paths now rescue the slot nodes by their markers
  (`slotChildren`) into `this._serverSlot` first, and the capture prefers them. A non-adoptable
  component still flashes, but nothing disappears.
- **JSX-value locals now hydrate in place (`codegen/hydrate.rs`, Phase 2.1e).** A layout or
  component that binds JSX to a local and renders it — `const body = <div/>; return frame ?
  <shell>{body}</shell> : body` (the `DocsLayout` idiom) — was not adoptable: the hydrate
  backend reported `JSX-as-value is not supported`, demoting the whole view to
  `RebuildIfServerChildren`, which discarded the server DOM on first paint (a content flash)
  and cascaded `HydrationMismatch`es through nested islands. The backend now emits such a local
  as a dual `{ build, adopt }` object: a `{body}` hole adopts the server subtree in place (a new
  `hydrateHole` runtime helper wrapping the `<!--$-->…<!--/-->` markers), and a bare-identifier
  dynamic-node branch adopts off the region cursor / rebuilds in the swap arm. Only the bare
  `const NAME = <jsx>` shape is adopted; a JSX value inside an object/array/ternary stays on the
  safe rebuild fallback. Covered by `codegen::hydrate` unit tests and a real-browser (CDP)
  `<Framed>` island in the web-cli hydrate e2e.

### Added

- **`$state` in-place mutation is rejected** (`lower.rs` `state_mutation_diagnostic`,
  wired in `otfw_cli`): a `$state` signal's value is replaced, never mutated, so
  `list.push(x)`, `Map`/`Set` mutators (`set`/`add`/`delete`/`clear`), `list[0] = x`,
  `list.length = 0`, `obj.a.b = x`, `obj.n++`, and `delete obj.key` update the data but
  notify no effect — silently losing the update. `otfwc build` now fails
  with the immutable-update / `reactive()` fix instead of miscompiling into a no-op
  (SPEC §3.4 item 10). Detection is symbol-precise via the semantic model: a shadowing
  local or an alias is not flagged; read methods (`map`/`filter`/…) stay legal; and
  `$ref`/`$derived`/`$context` are excluded so DOM writes like `el.scrollTop = 0` on a
  `$ref` remain valid. Since the compiler runs no type checker, mutating *method*
  names are gated by the value's inferred shape: array mutators fire on an
  array/unknown shape, while `Map`/`Set` mutators fire only on a statically-known
  `Map`/`Set` — so a plain object with a `set`/`add` method is not a false positive.
  A **written TS type** (`$state<Map<…>>(…)` type argument or `const x: Map<…> =
  $state(…)` annotation) is read syntactically and takes precedence over the
  initializer heuristic — so `$state<Map<…>>(load())` is caught even when the
  initializer is opaque. This is a syntactic read of the written annotation, not type
  inference (oxc runs no type checker). Assignment/index/`++`/`delete` are
  shape-independent. Covered by `tests/state_mutation.rs`.
- **DOM lifecycle hooks** (`lower.rs` + `codegen/csr.rs`/`hydrate.rs`): three new
  compiler macros alongside `onMount`/`onCleanup` — `onResize(cb)` (ResizeObserver on
  the host/root element), `onVisibilityChange(cb)` (IntersectionObserver; `cb(isIntersecting,
  entry)`), and `onMediaQuery(query, cb)` (`matchMedia`; `cb(matches, e)` called once
  synchronously at mount with the initial state, then on every change). Each desugars to a
  mount-shaped closure returning its disposer, so teardown rides the existing
  `_cleanups`/`runMount` path; SSG output stays free of them (dropped in lowering). A page
  whose root is not a single element gets a warning for the two observer hooks and their
  closures are skipped — emitting them would throw `observe(fragment)` at runtime
  (`onMediaQuery` is allowed anywhere); components always observe their custom-element
  host. `onMediaQuery` with wrong arity is a lowering diagnostic.
- **Lowering diagnostics reach the CLI.** `Lowered.errors` (skipped unsupported
  constructs, bad hook arity, …) are now merged into every backend module's errors
  (`csr`/`hydrate`/`ssg`), so `otfwc build` prints them as `warning:` lines — previously
  they were collected and silently dropped.
- **Component (Custom Element) hydration** (`codegen/hydrate.rs` + `csr.rs`, Phase 2.0 —
  see `docs/HYDRATION.md` §0/§3.2): the hydrate target now emits a **dual component**.
  csr gained a hydration-agnostic `ComponentView` hook — it splices a caller-provided
  body behind an `if (this.firstChild)` switch in `connectedCallback` (or, for a view
  that can't be adopted, a `replaceChildren()` rebuild guard) — and `hydrate.rs` supplies
  the adopt body (claim walk over `this`, prop aliases/snapshots/rest, effects/`$expose`/
  `onCleanup` into the cleanup sink). So a server-rendered `<web-*>` **adopts** its
  children on upgrade, while a client-`createElement`'d one (SPA navigation) still builds
  — the discriminator is the per-instance `this.firstChild`, not a global flag, and
  `csr.rs` stays a pure build-only backend. The page adopt walk also claims a child
  component's host (by its `.tag`) without recursing, so the component self-adopts.
  Components with a `{children}` slot, lists, or conditionals fall back to the rebuild
  guard (2.1). `csr::emit_module_with_adopt` threads the per-component `ComponentView`.
- **Hydrate backend** (`codegen/hydrate.rs`, Phase 2.0 — see `docs/HYDRATION.md`): a
  new target that emits client code which *adopts* the server-rendered DOM instead of
  rebuilding it. Where CSR does `document.createElement` + `appendChild`, Hydrate walks
  the existing nodes with a cursor and `claim`s them by position; the reactivity wiring
  (`bindText`/`bindAttr`/events/`effect`) is the same runtime as CSR, so the backend
  reuses `csr.rs`'s leaf emitters and only node acquisition is new. Reachable via
  `otfwc build --target=hydrate`, which emits a **dual module**: the full CSR output
  (`export default` build factory + Custom Elements, for client navigation) plus a named
  `export function hydrate(__root, props)` adopt factory per page (for first paint). A
  page the adopt walk can't handle yet (child components, lists, conditionals,
  `{children}`, JSX-as-value) gets CSR-only with a warning — it still works, just without
  hydration. Scope so far: pages/layouts with element/static-text/dynamic-text structure,
  static & dynamic attributes, `ref`, and events.
- SSG dynamic text holes now carry hydration markers: a `{value}` is emitted as
  `<!--$-->value<!--/-->` so the client can claim the text node even when the value is
  empty or adjacent to static text. Inert for plain SSG output (an HTML comment).
- MDX code fences emit a titled code block: a `<div class="otfw-code">` wrapping a
  header (language label, an optional filename taken from the fence info string —
  e.g. ` ```json package.json ` — and a copy button) above the highlighted `<pre>`.
  The copy button ships both a clipboard and a check glyph (`.otfw-copy-icon` /
  `.otfw-check-icon`); the theme swaps to the green check when `.is-copied` is set.

### Fixed

- **JSX inside `$expose` and the lifecycle hooks compiles instead of leaking raw
  JSX.** Same hole as `$effect` (below), same fix: the callback arguments of
  `onMount`/`onCleanup`/`onResize`/`onVisibilityChange`/`onMediaQuery` and the
  `$expose` object were only `.value`-injected, never probed for JSX — so
  `onMount(() => { nodes.push(<Child item={item}/>); … })` leaked the JSX verbatim.
  All of them now flow through the shared `$effect` templating in lowering
  (`Lowered.exposes`/`on_mounts`/… carry `EffectCb`), and codegen substitutes each
  embedded element as an inline IIFE at its placeholder, capturing the callback's
  locals. Rendering the callbacks through the emitter also records their helper
  usage, so a module whose *only* JSX-in-callback sits in a hook still imports
  `setProp`/`effect` (`codegen/csr.rs` `dom_hook_closures` moved onto the
  `Emitter`; hydrate reuses it via `dom_hook_closures_pub`).
- **JSX inside a `$effect` callback compiles instead of leaking raw JSX.** A `$effect`
  body embedding JSX (`for (…) { groups.push(<Child group={group}/>); }` followed by
  `container.replaceChildren(...groups)`) was injected verbatim — the callback was never
  probed for JSX, so `<Child group={group}/>` survived untouched into the emitted module
  and broke at the bundler. Effect arguments are now templated in lowering like any
  preserved statement (`lower.rs`: `Lowered.effects` is `Vec<EffectCb>` carrying extracted
  `ViewNode` branches) and codegen substitutes each branch as an inline IIFE at its
  placeholder, so loop/callback locals are captured correctly (`codegen/csr.rs`
  `effect_code`; the hydrate backend reuses it via `csr::effect_code_pub` — effects always
  *build* fresh nodes since SSG doesn't run them, and SSG drops effects as before).
- **JSX written inside a loop or callback body captures that scope's locals.** A JSX
  value embedded in a preserved statement (`groups.push(<Child group={group}/>)` inside
  a `for` body, a JSX-valued prop or list-source expression with an embedded callback)
  compiled to a node-builder *function hoisted to the component body*, while its effects
  and handlers still referenced the loop locals (`group`, `current`, …) — throwing
  `ReferenceError: group is not defined` the moment the builder ran. The CSR backend now
  substitutes each branch **inline as an IIFE at its placeholder**
  (`groups.push((() => { …; return c0; })())`), so the built view evaluates in exactly
  the scope the JSX was written in (`codegen/csr.rs` `inline_node_expr`, replacing the
  hoisted `{base}_value{N}` builders in `emit_value_stmt`, `dynamic_prop_code`, and
  `list_source_code`). SSG already composed inline HTML expressions (scope-correct);
  hydrate still rejects JSX-as-value (Phase 2.1) — unchanged.
- **A list `key={index}` reads the real index binding instead of `undefined`.** For
  `arr.map((item, index) => <li key={index}>…)`, the emitted key function bound a
  synthetic `_index` parameter while the interned key expression still referenced the
  callback's own `index` name — so the key evaluated against an undefined variable and
  keyed reconciliation broke. The key function now binds the callback's actual item/index
  names (`(item, index) => (index)`), matching the item builder. Fixed in both the CSR and
  hydrate backends (`codegen/csr.rs`, `codegen/hydrate.rs`).
- **JSX in a list's data expression compiles to a real node instead of falling through to
  a host `jsx-runtime`.** A JSX value embedded in the array a list maps over
  (`[{ icon: <b/> }].map(t => <li>{t.icon}</li>)`) was interned verbatim into the list
  source, so `<b/>` compiled to a `jsx-runtime` call — a framework-foreign element object
  that the item's text hole then stringified to `[object Object]`. The source is now
  templated like a JSX-valued prop: each embedded element becomes a node-builder (CSR /
  hydrate) or an `{ __html }` marker (SSG), and `ViewNode::List` carries the extracted
  `source_branches`. Previously only hoisting the array to a `const` worked; inline data
  now compiles correctly across all backends.
- Components survive a DOM move instead of going inert. A custom element's
  `disconnectedCallback` disposed its reactive effects, while `connectedCallback`'s
  `if (this._mounted) return` guard blocked re-initialization — so any element that was
  disconnected and reconnected (e.g. a layout slotting `{props.children}` into its own
  subtree via `replaceChildren`, which moves every nested node) ended up mounted but
  dead: signals no longer updated the DOM. Teardown is now deferred to a microtask and
  cancelled if the element reconnects in the same task, so a synchronous move keeps the
  component and its live effects intact; only a real removal tears down (and clears
  `_mounted` so a later genuine remount re-initializes). This is what made interactive
  components inside a `DocsLayout`-wrapped page stop reacting.
- MDX prose no longer fuses words across a soft line break. A wrapped paragraph like
  `code is\n**highlighted**` kept the newline in the text node; the downstream JSX
  compiler then trimmed that boundary newline, rendering "ishighlighted". Inline text
  whitespace (incl. soft line breaks) is now collapsed to a single space — as HTML and
  CommonMark render it — so words and inline marks stay separated. Code spans/fences
  keep their literal whitespace. Affects every output path (CSR and SSG share the
  compiled module).
- MDX syntax highlighting now covers JSX/TSX/TS/MDX code fences. syntect's default
  grammar set has no `jsx`/`tsx`/`ts`/`mdx` entries, so those fences silently fell
  back to plain text (no highlighting) — which was most of the documentation's
  examples. Such tokens are now aliased to the closest available grammar (`js`, `md`,
  `bash`) before falling back to plain text.
- Preserve a component's consumer `class` prop. When a component declares a `class`
  prop, the host-styling hook stamp (`classList.add`) re-entered
  `attributeChangedCallback` and overwrote the prop with the post-stamp string — so
  `<Link class="…">` rendered only the host hook. The stamp is now bracketed by a
  guard flag so the synthetic mutation is ignored by the prop sync.
