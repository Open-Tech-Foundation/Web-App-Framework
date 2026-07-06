# otfw_compiler

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

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
  names are gated by the shape inferred from the `$state(init)` initializer: array
  mutators fire on an array/unknown shape, while `Map`/`Set` mutators fire only on a
  statically-recognizable `new Map`/`new Set` — so a plain object with a `set`/`add`
  method is not a false positive. Assignment/index/`++`/`delete` are shape-independent.
  Covered by `tests/state_mutation.rs`.
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
