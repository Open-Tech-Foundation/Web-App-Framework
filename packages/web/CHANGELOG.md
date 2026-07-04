# @opentf/web

## [Unreleased]

### Added

- **Reactive ownership scopes** (`scope()` in the signals core, exported from the package
  root): collects the disposers of every effect created while a build function runs, so a
  dynamic region can tear its bindings down as a unit. Effects created during a flush-time
  re-run never attach to an ambient scope — ownership is always explicit.

### Fixed

- **Evicted keyed-list items leaked their binding effects.** `bindList`/`hydrateList`
  removed a stale row's DOM node but left its `bindText`/`bindAttr` effects subscribed, so
  any signal shared across rows (e.g. a selection signal every row's `class` reads)
  accumulated one zombie effect per discarded row and re-ran them all on every later write.
  In the js-framework-benchmark suite this made *select row* cost more than *create 1,000
  rows* (~85 ms vs ~65 ms unthrottled). Items now build inside a `scope` and are disposed on
  eviction; the list's own disposer also tears down all live items.
- **Swapped conditional branches leaked their binding effects** the same way: `bindChild`/
  `hydrateChild` regions now own each branch's effects and dispose them when the branch is
  replaced (including the discarded subscribe-only first build during hydration).
- **Unmounted pages leaked their binding effects**: `mount()` now builds a factory view
  inside a `scope` and registers its disposer as a lifecycle cleanup, so the router's
  navigation teardown stops every effect the outgoing page created.

## [0.7.0] - 2026-07-03

### Added

- **Component `{children}`-slot hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1d): a
  component used *with* children (`<Card><button onclick=…/></Card>`) now hydrates instead of
  falling back to a rebuild — the last structural region. SSG brackets a component's light-DOM
  slot with **distinct** `<!--c[-->…<!--c]-->` markers; the component's adopt walk steps over
  its slot with the new `skipSlot`, while the **composing parent** owns the slotted content's
  reactivity (it's the parent's JSX) and adopts it via the new `hydrateSlot`, which locates the
  slot by scanning the host for its marker. This is order-independent of when the component
  upgrades, because adoption only wires (never moves) nodes — so a parent page and a
  self-upgrading child island can co-adopt the same host's interleaved content. New runtime
  API: `skipSlot`, `hydrateSlot`, `SLOT_START`/`SLOT_END`.
- **Layout-chain / `{children}`-slot hydration** (`docs/HYDRATION.md` §3.2/§3.4 / phasing
  2.1c): a layout-wrapped route now *adopts* its whole server DOM instead of falling back to
  a CSR rebuild — the last structural region. A page/layout now emits `hydrateAt(cursor,
  props)` (the adopt walk over an existing cursor) plus a `hydrate(root, props)` wrapper
  (`= hydrateAt(cursor(root), props)`); SSG brackets a page/layout `{children}` slot with
  `<!--[-->…<!--]-->`; and the router's new `hydrateRouteNode` threads **one cursor** through
  the entire layout chain — each layout claims its own structure and, at its `{children}`
  slot, hands its cursor to the nested route's adopt thunk (`props.children(cur)`), which
  claims the inner subtree and advances the cursor, down to the page. A route whose page or
  any layout isn't adoptable falls back to a clean CSR build; a mismatch anywhere disposes
  each layer's partial wiring on the way up. New runtime API: `hydrateRouteNode`.
- **Conditional / dynamic-node hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1b): a
  server-rendered `{cond ? <A/> : <B/>}` (or `{cond && <X/>}`) region now *adopts* the
  rendered branch instead of rebuilding. SSG brackets the branch with `<!--[-->…<!--]-->`
  (a falsy `&&` renders an empty region, like an empty list); the Hydrate codegen emits an
  adopt fn and a CSR build fn per branch, and the new `hydrateChild` runtime helper runs the
  adopt closure to claim the rendered branch off the shared cursor, then swaps to a
  freshly-built branch (via the build closure) when a later reactive change selects a
  different one — the closing `<!--]-->` is the swap anchor. `bindChild` is refactored to
  share the swap effect (`childEffect`) with `hydrateChild`. New runtime API: `hydrateChild`.
  The list/conditional region markers and their claim helpers are renamed to the neutral
  `REGION_START`/`REGION_END` and `claimRegionStart`/`claimRegionEnd` (shared by both).
- **Keyed-list hydration** (`docs/HYDRATION.md` §3.1 / phasing 2.1a): a server-rendered
  `{items.map(...)}` region now *adopts* instead of rebuilding. SSG brackets the region
  with `<!--[-->…<!--]-->` markers; the Hydrate codegen emits an adopt-item walk (claiming
  each item's root node off the shared cursor) plus a CSR build-item function, and the new
  `hydrateList` runtime helper seeds the keyed reconcile from the adopted `{signal, node}`
  pairs — so the first paint claims the server `<li>`s with no flash, and a later data
  change builds/moves/removes items from that adopted state (kept items keep their identity).
  The closing `<!--]-->` becomes the reconcile anchor. `bindList` is refactored to share the
  reconcile effect (`reconcileList`) with `hydrateList`. New runtime API: `hydrateList` and
  the shared region-marker helpers `claimRegionStart`/`claimRegionEnd`,
  `REGION_START`/`REGION_END`. A list-containing page that previously fell back to a CSR-only
  build now gets a full `hydrate` factory.
- **Compiler-driven rich data hydration** (`docs/HYDRATION.md` §3.7): a server-rendered
  island's props now cross to the client through a serialized payload — real JS values
  (objects, arrays, numbers), not lossy string attributes. During SSR/SSG, `ssgComponent`
  assigns each island a `data-h` id and records its JSON-safe props into a single
  `<script type="application/json" id="__otfw_h">` payload (injected by `otfw serve` and
  `--ssg`); the hydrate-target component's **constructor** reads `hydrationProps(this)` and
  initializes its prop *signals* from those rich values, falling back to the attribute/default
  when absent (client-created element on SPA nav, or a plain CSR build). This removes the
  per-component serialization boundary, the adopt-then-`setProp` flash, and the dependence on
  a hydrating ancestor to deliver props; `class`/`style` props also resolve to their own value
  rather than the host's merged attribute. Event-callback props are dropped from the payload
  (client-only) and still delivered by the parent walk. New runtime API: `hydrationProps`,
  and `beginHydrationCollect`/`endHydrationCollect` (server). A CSR-only app references no
  hydration helper. `renderRoute()` now also returns `hydration` (the payload JSON).

### Changed

- Hydration: the dual component's build-vs-adopt discriminator is now
  **`isHydrating() && this.firstChild`**, not `this.firstChild` alone (`docs/HYDRATION.md`
  §0/§3.4 — supersedes the earlier "no global flag" decision). The structural test can't
  tell a server-rendered host from a client-`createElement`'d one handed call-site children,
  so it mis-adopted on plain SPA navigation and mangled `{children}` components. Route chunks
  are lazy, so their custom elements upgrade during the router's `await import()`; the router
  now brackets first paint with `beginHydration()` (before the import) / `endHydration()` (in
  `finally`), so upgrading components observe the flag and adopt, while every later navigation
  builds. Adds `beginHydration`/`endHydration` to the runtime.

### Fixed

- Hydration: a **static prop on a server-rendered component now reaches the client**
  (`docs/HYDRATION.md` §3.2). `ssgComponent` reflects nothing onto the component host
  tag, so on adoption the upgrading component read a missing attribute (`null`) and its
  `bindText`/`bindAttr` clobbered the server-rendered value — a blank island. The Hydrate
  codegen now re-applies static component props through `setProp` during the adopt walk
  (exactly as the CSR build arm does), so the prop signal — and the adopted view — carry
  the right value.
- Hydration: an adopt-time **`HydrationMismatch` now recovers per component** (§3.5) —
  it is reported (never silent) and the component rebuilds via CSR through a shared
  `__build` closure; the rest of the page stays hydrated. Non-mismatch errors still route
  to the nearest `<ErrorBoundary>` as before.
- Hydration: the adopt walk now **collects `bindText`/`bindAttr` disposers** (it previously
  emitted them as bare calls), so a hydrated component tears them down on disconnect like
  the CSR path, and a page's partial walk disposes them if it throws a mismatch mid-way —
  no orphaned, double-subscribed effects after the router's fallback rebuild.
- Hydration: a `{children}`-slot component that falls back to rebuild no longer discards
  call-site children on client navigation (the pre-capture clear is now gated on
  `isHydrating()`), and no longer double-wraps its server DOM on first paint.
- Hydration: `skipNode` now asserts the aligned node is a real text node (like its sibling
  claim helpers) and throws `HydrationMismatch` on a cursor misalignment, surfacing the
  desync at the offending step instead of at an unrelated downstream claim.

## [0.6.0] - 2026-07-01

### Added

- Navigation mode (`docs/HYDRATION.md` §7): `mountApp({ nav })` selects `"spa"` (default —
  the client router intercepts same-origin `<Link>` clicks for reload-free navigation) or
  `"mpa"` (every navigation is a full page load; each page hydrates its own first paint).
  MPA is the always-available substrate — `nav` only toggles the SPA enhancement, and in
  MPA mode the router skips the `popstate` listener. `<Link reload>` is a per-link escape
  hatch that forces a full navigation even in SPA mode. `shouldInterceptNav()` exposes the
  current mode to `<Link>`.
- Router first-paint hydration boot switch (Phase 2.0 — see `docs/HYDRATION.md` §3.4):
  `mountApp` detects the server sentinel `data-otfw-hydrate` on the root and, when the
  route module exposes a `hydrate` adopt factory, the router calls it to *adopt* the
  server-rendered DOM instead of `replaceChildren()` + rebuild. Only leaf routes (no
  layout chain) hydrate so far; a missing `hydrate` export, a layout chain, or a thrown
  mismatch (reported via `reportError`, never silent) falls through to a clean CSR build.
  `mountApp` now returns the initial navigation promise.
- Hydration primitives (`runtime/hydrate.js`, Phase 2 foundation — see
  `docs/HYDRATION.md`): a cursor walk that adopts the server DOM instead of rebuilding
  it — `cursor`, `claimElement`, `claimText` (the `<!--$-->…<!--/-->` text-hole scheme),
  `skipNode`, the `isHydrating` / `runHydration` flag, and `HydrationMismatch`. Reactivity
  still wires through the existing `bindText`/`bindAttr`; only node acquisition is new.
  Inert until the Hydrate codegen and client-boot switch consume it.
- `renderRoute` now returns an HTTP `status` alongside `{ html, metadata }`: `200` when
  the path matched a real route, `404` when it fell back to the registered 404 page. The
  new `otfw serve` SSR server uses it to set the response status; SSG ignores it (the
  field is additive, so existing `{ html, metadata }` destructuring is unaffected).
- `web-internal-code-block` built-in (emitted by the MDX front-end as `<CodeFence>`):
  renders a trusted, build-time-highlighted code block like `RawHtml`, but **wires its
  own copy button** on connect. So a code block's copy action works wherever it's
  rendered, with no delegated listener in an ancestor layout. SSG renders the markup
  inline; the behavior wires when the element upgrades in the browser.
- `copyText(text)` and `copyWithFeedback(button, text)` clipboard helpers (async
  Clipboard API with an `execCommand` fallback for non-secure contexts).

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
