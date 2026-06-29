# Hydration (Phase 2)

> **Status:** Design — decided. This document is the authoritative design for the
> Hydrate backend and the client hydration runtime. It refines `ARCHITECTURE.md §6`
> ("Hydrate" / "SSR") and §4.8 (structural addressing). Where this document and code
> disagree, this document is the source of truth until amended.
>
> Sections marked _(decided)_ are settled; _(open)_ are pending sub-design.

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
static text. List/conditional region markers (`<!--[-->`/`<!--]-->`) follow in 2.1.

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

Output shapes:

- **Page / layout** _(implemented)_ → `export default function (__root, props)`: the
  router passes the container, the factory adopts its children with a cursor and returns
  the claimed root.
- **Component** _(Phase 2.1)_ → a `connectedCallback` that adopts `this.childNodes`
  when `isHydrating()` instead of building a fresh subtree.

### 3.3 Runtime hydration context

A small runtime module (`runtime/hydrate.js`, _implemented_): a DOM **cursor**
(`cursor(parent)`), claim primitives (`claimElement(cur, tag)`, `claimText(cur)`,
`skipNode(cur)`), the `isHydrating` / `runHydration` flag, and `HydrationMismatch`.
There is no separate hydrate *binding* API — the Hydrate backend wires reactivity by
calling the existing `bindText`/`bindAttr` on the **claimed** nodes, since those
helpers already operate on existing nodes. Only acquisition (the claims) is new.

### 3.4 Client boot switch + custom-element adoption _(the subtle part)_

When the client bundle runs `customElements.define`, every server-rendered `<web-*>`
already in the DOM **upgrades and fires `connectedCallback` synchronously** — so
components self-hydrate as islands. The coordination:

- **`connectedCallback` branches:** _initial hydration **and** has server children_
  → adopt; otherwise → build. (Today it unconditionally builds, which over a
  server-rendered host would double the DOM.)
- **First render hydrates `#app`:** the router's initial render adopts existing
  children instead of `replaceChildren()` (`runtime/router.js`). Subsequent client
  navigations keep the CSR build path — there is no server HTML to adopt for a
  client-navigated route.
- **A server sentinel** (`<div id="app" data-otfw-ssr>`, stamped by the SSG/SSR
  shell injection) tells the client to hydrate vs mount.
- **Flag lifecycle:** `__OTFW_HYDRATING` is set before the defines that trigger
  upgrades and cleared after the initial pass. This ordering is where hydration bugs
  live — it gets dedicated tests (§5).

### 3.5 Mismatch detection & recovery — per-component _(decided)_

Per `ARCHITECTURE.md §6`, mismatches are "detected at a specific slot path and
reported, never silent." Because components are custom elements, the natural recovery
boundary is **per component**: on an adopt mismatch (expected tag/shape ≠ found),
log the slot path to the dev overlay and **rebuild that component via CSR**. The rest
of the page stays hydrated. Whole-page bail-out is not used — it throws away good work
and hides where the mismatch was.

### 3.6 Data — deferred to Phase 3, hook reserved now

Phase 2 has no loaders, so signals initialize from identical `$state` values on both
sides — hydration is deterministic and matches. Genuinely non-deterministic code
(`Date.now()`, `Math.random()`, browser-only reads) is what the mismatch policy
(§3.5) catches. We reserve a `<script type="application/json">` data channel in the
shell for Phase 3 loader-data hydration (TanStack-style), but do not implement it here.

---

## 4. Phasing

| Step | Scope |
|---|---|
| **2.0** | marker scheme ✓ + `runtime/hydrate.js` primitives ✓ + `hydrate.rs` backend for pages/layouts (element/text/attrs/events) ✓ + `otfwc --target=hydrate` ✓ + ssg→hydrate e2e ✓. **Remaining:** client-boot switch + component (custom-element) adoption + mismatch logging |
| **2.1** | variable structure: lists + conditionals hydration |
| **2.2** | per-component island recovery wired into the dev overlay |
| **2.3** _(deferred)_ | lazy/partial island directives (`client:idle` / `visible` / `media`) — leveraging the custom-element lifecycle. **Not in Phase 2**; revisited once core hydration is solid. |

---

## 5. Verification bar _(decided)_

Hydration is notoriously bug-prone in ways unit tests miss (timing of upgrades,
whitespace nodes, double mounts). The bar:

- **Unit tests** for the runtime primitives and marker parsing (happy-dom).
- **A CDP-driven browser e2e** (like `packages/web-docs/tests/e2e/`) that asserts the
  two properties that actually define correct hydration:
  1. **No DOM mutation on hydrate** — record the server DOM, hydrate, assert the node
     identities are unchanged (adoption, not re-creation).
  2. **Server state preserved + interactivity works** — a counter rendered at `5` on
     the server is still `5` after hydrate and increments on click without a reset/flash.

---

## 6. Sub-design decisions & open items

**Decided:**

- **Marker byte scheme** (§3.1) — `<!--$-->value<!--/-->` for text holes; empty value
  synthesizes an anchor; static structure marker-free. Implemented in `runtime/hydrate.js`.
- **Node acquisition** (§3.3) — **cursor walk**, not absolute path indexing (both honor
  §4.8; cursor matches Solid and aligns 1:1 with the marker-free server output).

**Open:**

- List/conditional region markers and their reconcile-from-N adoption (2.1).
- `__OTFW_HYDRATING` flag lifecycle across nested component upgrades (§3.4) — the flag
  primitive exists; the define-time ordering lands with the boot switch.
