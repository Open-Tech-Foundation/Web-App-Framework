# Hydration (Phase 2)

> **Status:** Design — decided. This document is the authoritative design for the
> Hydrate backend and the client hydration runtime. It refines `ARCHITECTURE.md §6`
> ("Hydrate" / "SSR") and §4.8 (structural addressing). Where this document and code
> disagree, this document is the source of truth until amended.
>
> Sections marked _(decided)_ are settled; _(open)_ are pending sub-design.

---

## 0. The decided architecture (read this first)

Two render axes, settled:

- **Render mode** — *when* the HTML is produced: **CSR** (client, at runtime), **SSG**
  (build time), **SSR** (server, per request).
- **Navigation mode** — *how* the next route loads: **SPA** (a client router swaps the
  view without a full reload) or **MPA** (the browser does a full navigation).

**MPA is the substrate, not a mode you opt out of.** Every SSG/SSR route is independently
server-rendered and hydrates its own first paint, so direct entry, refresh, open-in-new-tab,
crawlers, and no-JS all get a complete page **regardless of the client router**. SPA is a
progressive enhancement layered on top; remove it and the app degrades cleanly to full MPA.

**Default: SSG/SSR apps take over as SPA for smooth navigation.** First paint *adopts* the
server DOM; a subsequent `<Link>` click *builds* the next route on the client. A component
therefore needs **both** behaviors — and that dual requirement comes from **SPA navigation,
not from the CSR backend.**

**Where build-vs-adopt lives:** in **`hydrate.rs`**, which owns the *dual component* (build
+ adopt). The discriminator is **`isHydrating() && this.firstChild`** — the global
first-paint flag (§3.3) gated by a cheap structural sanity check. Adopt during the one-shot
first-paint pass over server DOM; build on every client navigation.

> **Superseded decision (was: `this.firstChild` alone).** The original design used only the
> per-instance structural test, on the reasoning that "server-rendered ⇒ has children ⇒
> adopt; client-`createElement`'d ⇒ empty ⇒ build," with no global flag to sequence. That is
> **wrong in two cases the structural test cannot distinguish**: (a) a component created on a
> client navigation and handed **call-site children** (`<Card><p/></Card>`) also has a
> `firstChild`, so it would mis-adopt and throw a mismatch; (b) a not-yet-adoptable
> `{children}` component can't tell its server-rendered *wrapper* from its call-site slot
> children, so it either loses children (clear-first) or double-wraps (capture-first). Both
> are only resolvable by knowing *whether this is the first-paint pass* — which is exactly
> what the flag encodes. The flag was always in `runtime/hydrate.js`; it is now the
> discriminator.

`csr.rs` still emits only *build* logic and the adopt body `hydrate.rs` hands it; it now also
splices the `isHydrating()` switch and the mismatch-recovery scaffold (§3.5) around that body.
A **pure-CSR app never references any hydration helper** — the flag/`HydrationMismatch`/
`reportError` imports appear only when `hydrate.rs` supplies an `Adopt`/`RebuildIfServerChildren`
view. So CSR stays clean in practice; it is no longer *by construction* hydration-blind.

This is the SolidStart shape (fine-grained adopt, one artifact branches per instance),
expressed on Custom Elements. See §7 for the `nav` config that lets an app choose MPA, in
which case components only ever adopt (the build arm is dead and can later be dropped).

> **Implemented so far (2.0–2.1b):** leaf pages, standalone components, components *used*
> in a page (the page claims the host; the component self-adopts), **keyed lists**
> (`{items.map(...)}`), and **conditionals / dynamic-node regions** (`{cond ? <A/> : <B/>}`,
> `{cond && <X/>}`) — all bracketed by `<!--[-->…<!--]-->` — hydrate. **Not yet:** components
> that take a `{children}` slot, and **layout-chain** routes — both need `{children}`-region
> markers and cross-module cursor threading. Until then a layout-wrapped route, or a
> component with children, falls back to a clean CSR build.

| Mode | Nav | First paint | Subsequent nav | Components |
|---|---|---|---|---|
| CSR | SPA | client build (empty `#app`) | client build | pure build (`csr.rs`) |
| SSG | SPA *(default)* / MPA | static HTML + adopt | SPA: build · MPA: full load | dual (`hydrate.rs`) |
| SSR | SPA *(default)* / MPA | per-request HTML + adopt | SPA: build · MPA: full load | dual (`hydrate.rs`) |

---

## 1. What hydration is, and why it's the keystone

OTF Web can produce a route's HTML at build time (SSG) or per request (SSR). But
**today the client throws that HTML away**: on first paint the router does
`rootEl.replaceChildren()` and rebuilds the page from scratch via CSR. So server
HTML is first-paint + SEO only; the three render modes (SSG / SSR / CSR) differ
*only in when the HTML is produced*, not in how the client behaves.

**Hydration** is the missing client behavior that makes them differ: instead of
rebuilding, the client **adopts** the existing server DOM — claims the nodes,
wires reactivity (signals, effects, events) onto them, and never re-creates what
the server already sent. No flash, no double work, server state preserved.

Until hydration exists, "SSG vs SSR" is cosmetic on the client. After it, SSG/SSR
become genuinely cheaper-to-interactive than CSR.

---

## 2. The strategy landscape (why we choose what we choose)

A spectrum of "how much JS runs on the client at load":

| Framework | Strategy | Client work at load |
|---|---|---|
| React / Next (classic) | `hydrateRoot` walks the whole VDOM tree, reconciles against the DOM | **O(app size)** — every component re-runs |
| Next App Router (RSC) | Server Components serialize to a flight payload (never hydrate); only `"use client"` components hydrate; streaming Suspense boundaries hydrate progressively | O(interactive parts) |
| Astro | Islands — zero JS by default; opt-in `client:load/idle/visible/media/only`; each island isolated | O(islands requested) |
| Solid / SolidStart | Fine-grained: no VDOM/diff; re-runs setup to rebuild the signal graph, **adopts** existing nodes via hydration keys, wires only dynamic bindings | O(dynamic bindings) — very low |
| Svelte / SvelteKit (5) | Compiler emits code that **claims** existing nodes; comment markers delimit `{#if}`/`{#each}`; signals internally | O(component count) |
| TanStack (Router/Start) | **Data** hydration: isomorphic loaders + dehydrate/rehydrate loader/query results into HTML; DOM hydration delegated to the host renderer | O(host renderer) |
| Qwik (contrast pole) | **Resumability** — no hydration; serialize listeners + state into HTML, resume lazily on interaction | ≈O(0) |

Two structural facts decide our approach:

1. **VDOM frameworks pay a "re-run the tree" tax; signal/compiler frameworks don't.**
   OTF Web is zero-VDOM with fine-grained signals and a compiler — it is already in
   the **Solid / Svelte 5 camp**: adopt nodes, wire only what's reactive, no diff.
2. **Every OTF Web component compiles to a native Custom Element.** A custom element
   self-upgrades and has its own lifecycle, so **each component is already an
   independently-hydrating island** — Astro's model, for free, on web standards.

**Our position:** _Solid-grade fine-grained hydration with Astro-grade island opt-in,
built on Custom Elements._

We explicitly **do not** adopt VDOM tree reconcile (we have no VDOM) or Qwik-style
resumability (a much larger serialization commitment — a possible future, not now).

Data hydration (TanStack) is **orthogonal** to DOM hydration and belongs to Phase 3
(SSR loaders), not here.

---

## 3. Design _(decided)_

Five pieces. Each maps to an implementation area.

### 3.1 Hydration markers — comment-delimited anchors, only where structure is variable

Static structure is adopted by **structural path** from the component root
(`ARCHITECTURE.md §4.8`) and needs **no markers**. Markers are needed only for
*variable* structure, where path-walking alone is ambiguous:

- **Text holes** — `<p>Count {n}</p>` server-renders to one text node `"Count 5"`;
  the client cannot tell where the static text ends and the dynamic hole begins.
- **Lists** — `{items.map(...)}` renders N items; the client must find the region
  boundary to reconcile from N.
- **Conditionals** — `{cond ? <A/> : <B/>}` renders one branch; the client must know
  which region the branch occupies to swap it.

**Decision:** emit **comment anchors** (`<!--[-->` … `<!--]-->`, and a single
`<!--$-->` for a one-node text hole) around variable regions only; static subtrees
stay marker-free and adopt by path. This mirrors Solid/Svelte 5 and honors §6's
"emit markers only where structure is variable."

Markers are part of the **shared server output** (`ssg.rs`) because SSG and SSR both
render through it (`ARCHITECTURE.md §6` — "SSR shares the SSG path"). The byte cost is
small (comments around dynamic regions only) and is the price of zero-flash adoption.

**Concrete scheme _(decided, implemented in `runtime/hydrate.js`)_:** a dynamic text
hole is emitted as `<!--$-->value<!--/-->`. The `$`/`/` comment pair survives the HTML
parser's text-node merging, so the hole is findable even when `value` is empty
(`<!--$--><!--/-->` → the client synthesizes an empty text anchor) or adjacent to
static text. **List and conditional regions** are bracketed by `<!--[-->…<!--]-->`
(Phase 2.1, _implemented_): the client claims the rendered content off the shared cursor
and the closing `<!--]-->` becomes the reconcile/swap anchor. A list holds one item root
per item; a conditional holds the one rendered branch (or nothing, for a falsy `&&` — an
empty region, exactly like an empty list).

> **Hazard handled:** the HTML parser collapses/merges adjacent and empty text nodes
> and trims whitespace. The `$`/`/` markers survive that; and because `ssg.rs`
> concatenates server output with no inter-element padding, the re-parsed DOM carries
> text nodes only where the template does — so a cursor walk stays aligned 1:1.

### 3.2 `hydrate.rs` codegen backend — adopt, don't create _(implemented for pages)_

Sibling to `csr.rs`. The crucial observation: **CSR and Hydrate differ only in node
acquisition.** CSR does `createElement` + `appendChild`; Hydrate adopts the existing
node from a DOM cursor (`claimElement`/`claimText`/`skipNode`). The **reactivity wiring
is identical** — it calls the same runtime helpers (`bindText`, `bindAttr`, event
listeners, `effect`) on the claimed nodes.

**What "not a copy" means in practice:** the CSR `Emitter` was *not* refactored into a
Create/Adopt-parameterized walker (that touches CSR's hot path and risks regressions).
Instead `hydrate.rs` is a focused backend that **reuses** `csr.rs`'s leaf emitters
(`js_string`, event-name/options handling) and the shared **runtime** binding helpers;
the adopt-walk is its own small pass (it must be — claiming is structurally different
from creating). The shared surface is the runtime contract, which is what actually
guarantees server/client agreement.

Output shapes (the hydrate target is a **dual module** — it emits the full CSR output
*and* the adopt path, so one client bundle both hydrates first paint and CSR-renders
client navigations):

- **Page / layout** _(implemented)_ → the CSR `export default` build factory **plus** a
  named `export function hydrate(__root, props)`: the router calls `hydrate(container,
  props)` on first paint (adopt) and the default factory on client navigation (build). A
  page the adopt walk can't handle yet gets CSR-only (no `hydrate` export); it still
  works, just without hydration.
- **Component** _(implemented)_ → `hydrate.rs` emits the **dual component**: one
  `connectedCallback` that branches on **`isHydrating() && this.firstChild`** — during the
  first-paint pass a server-rendered host *adopts* `this.childNodes`; a client-`createElement`'d
  host on SPA nav *builds* a fresh subtree. The CSR build is factored into a `__build` closure
  shared by the navigation arm and mismatch recovery (§3.5). All the class scaffolding (prop
  signals, host-class hook, error guard, effect teardown, `attributeChangedCallback`) is shared
  and emitted by a `csr.rs` helper; `hydrate.rs` reuses csr's build-view walk for the build arm
  and contributes only the adopt walk. `csr.rs` emits only build logic + the switch scaffold —
  it never generates adopt *steps*.

### 3.3 Runtime hydration context

A small runtime module (`runtime/hydrate.js`, _implemented_): a DOM **cursor**
(`cursor(parent)`), claim primitives (`claimElement(cur, tag)`, `claimText(cur)`,
`skipNode(cur)` — which asserts a text node, surfacing a cursor desync at its source),
the first-paint flag (`isHydrating()`, with `runHydration(fn)` for synchronous scopes and
`beginHydration()`/`endHydration()` for the async first-paint pass the router brackets),
and `HydrationMismatch`. There is no separate hydrate *binding* API — the Hydrate backend
wires reactivity by calling the existing `bindText`/`bindAttr` on the **claimed** nodes,
since those helpers already operate on existing nodes. Only acquisition (the claims) is new.

### 3.4 Client boot switch + custom-element adoption

- **First render hydrates `#app`** _(implemented)_ — `mountApp` detects the server
  sentinel `data-otfw-hydrate` on the root and, when the route module exposes a `hydrate`
  factory, the router calls it to adopt the existing children instead of
  `replaceChildren()` + build (`runtime/router.js`). Subsequent client navigations keep
  the CSR build path. Only **leaf routes** (no layout chain) hydrate so far; a
  layout-wrapped route, or a thrown mismatch, falls through to a clean build.
  **Pending (2.1):** `{children}`-region markers so the layout chain hydrates.
- **A server sentinel** _(implemented)_ — `<div id="app" data-otfw-hydrate>`, stamped by
  the shell injection (`stampHydrateSentinel`) whenever the client bundle was built for
  the hydrate target. The toolchain wires this for `otfw serve` (always) and `otfw build
  --ssg` (pre-rendered pages have markup to adopt); a plain CSR `otfw build` mounts into
  an empty `#app`, so it keeps the leaner CSR bundle and stamps no sentinel. The compiler
  serve protocol carries the target as a token (`csr`/`ssg`/`hydrate`), so the client
  build requests `--target=hydrate` and gets the dual module per route.
- **`connectedCallback` branches on `isHydrating() && this.firstChild`** _(implemented)_ —
  route chunks are code-split (`() => import(...)`), so a route's `customElements.define`
  runs **during the router's `await import()`**, and every server-rendered `<web-*>` upgrades
  synchronously *before* the page hydrate factory runs. The router therefore sets the flag
  with `beginHydration()` **before** importing the route module and clears it in `finally`,
  so those upgrading components observe it and adopt; the factory then claims the hosts and
  passes props (components self-hydrate as islands bottom-up, then the page wires the rest).
  On a later SPA navigation the flag is false, so the same class builds. (First-paint
  hydration is a single sequential boot step, so the module-global flag needs no re-entrancy
  guard; `runHydration` remains for synchronous unit tests.)

### 3.5 Mismatch detection & recovery — per-component _(implemented)_

Per `ARCHITECTURE.md §6`, mismatches are "detected at a specific slot path and
reported, never silent." Because components are custom elements, the natural recovery
boundary is **per component**: on an adopt mismatch (expected tag/shape ≠ found),
log the slot path to the dev overlay and **rebuild that component via CSR**. The rest
of the page stays hydrated. Whole-page bail-out is not used — it throws away good work
and hides where the mismatch was.

**Implemented:** the component's adopt arm is wrapped in `try { <adopt> } catch (e)`; a
`HydrationMismatch` is reported via `reportError` (not routed to `<ErrorBoundary>` — the
component *recovers*) and the shared `__build` closure rebuilds the subtree after clearing
the mismatched server DOM. Any non-mismatch error re-throws to the outer render guard
(`handleError` → nearest boundary), as before. A **page**'s adopt walk collects its effect
disposers into a local `__disposers` and, if it throws partway, disposes them before
rethrowing — so the router's fallback CSR rebuild doesn't leave the partial walk's
`bindText`/`bindAttr`/`effect` subscriptions orphaned and double-subscribed.

### 3.6 Data — loader data deferred to Phase 3; **island props hydrate now** (§3.7)

Phase 2 has no *loaders*, so `$state` signals initialize from identical values on both
sides — hydration is deterministic and matches. Genuinely non-deterministic code
(`Date.now()`, `Math.random()`, browser-only reads) is what the mismatch policy (§3.5)
catches. The reserved `<script type="application/json">` data channel is now **used for
component-prop hydration** (§3.7); loader-data hydration (TanStack-style dehydrate/rehydrate
of fetched data) still lands in Phase 3 on the same channel.

### 3.7 Rich data hydration — the serialized props payload _(implemented)_

**The problem this removes.** A component is a Custom Element, so on the server it can only
receive props as **string attributes** — but `ssgComponent` deliberately reflects *nothing*
onto the host (rich values don't round-trip through attributes; `class` collides with the
styling hook). The earlier stopgap was: render the value into the view, then on the client
re-apply each prop from a hydrating *ancestor* walk (`setProp`) after the component had
already upgraded with a missing/`null` prop. That is lossy (only ancestors that hydrate can
deliver props; rich objects can't be attributes at all), flashes (upgrade-then-correct), and
depends on upgrade ordering. It is the framework's per-component **serialization boundary**.

**The fix — a compiler-driven payload.** During SSR/SSG, `ssgComponent` assigns each island a
`data-h` id and records its **JSON-safe props** into one payload; the shell embeds it as a
single `<script type="application/json" id="__otfw_h">`. The hydrate-target component's
**constructor** reads `hydrationProps(this)` (by the host's `data-h` id) and initializes its
prop **signals from the real JS values** — objects, arrays, numbers — falling back to the
attribute/default when absent (a client-`createElement`'d element on SPA nav, or a plain CSR
build with no payload). So:

- **Rich props round-trip** — an island can take `config={{…}}`/arrays; not just strings.
- **No flash** — the prop is correct at upgrade time; no adopt-then-`setProp` correction. The
  page walk no longer re-applies static props at all, and a dynamic prop's first effect run
  now matches the payload value (deterministic), so it doesn't repaint either.
- **No ordering dependence** — a standalone island reads its own payload; it doesn't need a
  hydrating ancestor to hand it props.
- **`class`/`style` props resolve cleanly** — the payload carries the prop's own value, not
  the host's merged `class` attribute (which includes the styling hook).

Mechanics: functions (event-callback props) are dropped by the JSON round-trip — they are
client-only and still delivered by the parent walk (invisible, so flash-free); `<` is escaped
so a value can't break out of the `<script>`; the payload is collected only during
`renderRoute` (SSR/SSG), so a plain CSR build ships neither ids nor payload. `csr.rs` emits the
payload-reading constructor **only for the hydrate target** — a CSR-only app references no
hydration helper. Loader/query data (Phase 3) will ride the **same** channel.

> **Not covered:** props whose values are genuinely non-serializable *and* visible (a live DOM
> node, a class instance) still can't cross — but those aren't hydratable in any framework
> without a custom (de)serializer, which is a Phase 3 concern. Structural region markers
> (`{children}`/layout chain; lists + conditionals done in 2.1a/2.1b) remain the separate 2.1 axis; data hydration is orthogonal
> to them.

---

## 4. Phasing

| Step | Scope |
|---|---|
| **2.0** | marker scheme ✓ + `runtime/hydrate.js` primitives ✓ + dual-emit `hydrate.rs` (CSR build + `hydrate` adopt factory for pages) ✓ + `otfwc --target=hydrate` ✓ + router boot switch (leaf routes) ✓ + toolchain wiring (serve-protocol target token + hydrate client bundle + `data-otfw-hydrate` sentinel in `otfw serve`/`--ssg`) ✓ + **dual component (build/adopt via `isHydrating() && this.firstChild`; server props re-applied on adopt; per-component mismatch → CSR rebuild)** ✓ + **`nav` config (spa/mpa) + `<Link reload>`** ✓ + ssg→hydrate, router-boot, serve-e2e & real-browser (CDP) hydration e2e (leaf page + component island + prop island) tests ✓ |
| **2.5** | **compiler-driven rich data hydration (§3.7)** — `ssgComponent` serializes each island's JSON-safe props into the `<script id="__otfw_h">` payload (`data-h` ids); the hydrate-target constructor reads `hydrationProps(this)` and initializes prop signals from the rich values (objects/arrays), no attribute round-trip, no flash. Payload injection in `otfw serve`/`--ssg`. ssg-collector + reader unit tests, codegen tests, and a real-browser (CDP) object-prop island e2e ✓ |
| **2.1a** | **keyed-list hydration** ✓ — server brackets the region with `<!--[-->…<!--]-->`; `hydrate.rs` emits an adopt-item walk (claims each item root off the shared cursor) + a CSR build-item fn, and `hydrateList` seeds the keyed reconcile from the adopted `{sig, node}` pairs so later data changes build/move/remove with no first-paint flash. ssg-marker + codegen tests, an ssg→hydrate happy-dom round-trip, and a real-browser (CDP) list adopt + reconcile e2e ✓ |
| **2.1b** | **conditional / dynamic-node hydration** ✓ — the server brackets the rendered branch with `<!--[-->…<!--]-->`; `hydrate.rs` emits an adopt fn + a CSR build fn per branch, and `hydrateChild` claims the rendered branch (adopt closure) then swaps to a freshly-built branch on change (build closure), the closing marker as the swap anchor. A falsy `&&` adopts an empty region. codegen tests, an ssg→hydrate happy-dom round-trip, and a real-browser (CDP) adopt + swap-both-ways e2e ✓ |
| **2.1c** | **layout-chain / `{children}`-slot** adoption — the remaining variable region; needs `{children}` markers + cross-module cursor threading (a layout's `hydrate` fn hands the cursor to the page's at the slot) |
| **2.2** | per-component island recovery wired into the dev overlay |
| **2.3** _(deferred)_ | lazy/partial island directives (`client:idle` / `visible` / `media`) — leveraging the custom-element lifecycle. **Not in Phase 2**; revisited once core hydration is solid. |

---

## 5. Verification bar _(decided)_

Hydration is notoriously bug-prone in ways unit tests miss (timing of upgrades,
whitespace nodes, double mounts). The bar:

- **Unit tests** for the runtime primitives and marker parsing (happy-dom). _(done)_
- **A CDP-driven browser e2e** _(implemented for leaf routes —
  `packages/web-cli/tests/e2e/hydrate-browser.mjs`)_ that drives the real `otfw serve`
  in headless Chromium and asserts the two properties that actually define correct
  hydration:
  1. **No DOM mutation on hydrate** — a document-start MutationObserver tags every
     server node as the parser inserts it; after hydrate the live `<main>`/`<button>`
     still carry the tag and zero tagged nodes were removed (adoption, not re-creation).
  2. **Server state preserved + interactivity works** — the counter shows its server
     value after hydrate and increments on click, on the same adopted text node, with no
     reset/flash.

  The harness extends naturally to component/layout hydration once those land (2.1).

---

## 6. Sub-design decisions & open items

**Decided:**

- **Marker byte scheme** (§3.1) — `<!--$-->value<!--/-->` for text holes; empty value
  synthesizes an anchor; static structure marker-free. Implemented in `runtime/hydrate.js`.
- **Node acquisition** (§3.3) — **cursor walk**, not absolute path indexing (both honor
  §4.8; cursor matches Solid and aligns 1:1 with the marker-free server output).

- **Component build-vs-adopt discriminator** (§0, §3.2) — **`isHydrating() && this.firstChild`**:
  the global first-paint flag, gated by a structural sanity check. _Supersedes the earlier
  "`this.firstChild` alone, no global flag" decision_, which couldn't distinguish a
  server-rendered host from a client-created one handed call-site children (§0 has the full
  rationale). The feared "`__OTFW_HYDRATING` lifecycle across nested upgrades" is a non-issue
  because route chunks are lazy: the flag is set for the single, sequential first-paint import
  and cleared in `finally`, so there is nothing concurrent to sequence.
- **Navigation model** (§0, §7) — SSG/SSR default to SPA (client router); MPA is the
  always-available substrate, selectable via `nav` config.
- **List + conditional region markers** (§3.1, 2.1a/2.1b) — `<!--[-->…<!--]-->` bracket the
  region. `hydrateList` adopts each item root off the shared cursor and seeds the keyed
  reconcile; `hydrateChild` adopts the rendered conditional branch and swaps it on change.
  Both leave the closing marker as the reconcile/swap anchor — post-hydration changes
  build/move/remove/swap with no first-paint flash.

**Open:**

- `{children}`-slot markers + layout-chain adoption via cross-module cursor threading (2.1c).
- MPA-only build optimization: when `nav: "mpa"`, components never client-build, so the
  build arm is dead and `hydrate.rs` could emit pure-adopt components (smaller bundle).

---

## 7. Navigation model & config _(decided)_

MPA always works (it's the substrate — §0). The `nav` config chooses whether the client
router *enhances* it into an SPA:

| `otfw.config` | Behavior | Components |
|---|---|---|
| `nav: "spa"` _(default)_ | client router intercepts same-origin `<Link>` clicks; no full reload | dual (build on nav, adopt on first paint) |
| `nav: "mpa"` | no interception; every nav is a full page load; each page hydrates its islands | only ever adopt (build arm dead) |

- **Per-link override:** `<Link reload>` forces a full navigation even in SPA mode (for
  crossing app boundaries or busting client state). External / cross-origin links and
  modified clicks (cmd/ctrl/middle) always do a full navigation regardless.
- The config flows from `otfw.config` → the generated app entry → `mountApp({ nav })`,
  which decides whether to wire client-side link interception.
