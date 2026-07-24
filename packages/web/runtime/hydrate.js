// Hydration primitives (Phase 2 — see docs/HYDRATION.md). The client *adopts* the
// server-rendered DOM instead of rebuilding it: it claims existing nodes and wires
// reactivity (bindText/bindAttr/events from dom.js) onto them. There is no separate
// "hydrate" binding logic — those helpers already operate on existing nodes; the only
// new work is *node acquisition*, which is what this module provides.
//
// Acquisition is a **cursor walk** (the decided approach, like Solid): the Hydrate
// codegen emits claim calls in the exact order the SSG backend emitted nodes, so a
// cursor over a parent's childNodes lines up 1:1 with the template. The server output
// carries no inter-element whitespace (ssg.rs concatenates with no padding), so the
// re-parsed DOM has text nodes only where the template does — the walk stays aligned.
//
// Markers (only where structure is variable): a dynamic text hole is delimited by
// `<!--$-->value<!--/-->` so it is findable even when the value is empty or adjacent
// to static text (which the HTML parser would otherwise merge into one text node).
// Static structure carries no markers and is claimed by position.

/** Comment markers bounding a dynamic text hole in server HTML. */
export const HOLE_START = "$";
export const HOLE_END = "/";

/** Comment markers bounding a variable structural region — a list or a conditional —
 * in server HTML (docs/HYDRATION.md §3.1): `<!--[-->` opens, `<!--]-->` closes. A list
 * holds one item root node per item; a conditional holds the currently rendered branch
 * (or nothing). The closing marker becomes the reconcile/swap anchor on hydration. */
export const REGION_START = "[";
export const REGION_END = "]";

/** Markers bounding a *component's* light-DOM `{children}` slot (docs/HYDRATION.md §3.1,
 * 2.1d) — distinct bytes from the list/conditional region markers so a component's own
 * internal regions never collide with its slot. The slot's content is the *parent's* JSX
 * (server-rendered here), so the parent finds this slot by its `<!--c[-->` marker within the
 * host and adopts the children (its reactivity), while the component steps over the slot. */
export const SLOT_START = "c[";
export const SLOT_END = "c]";

const ELEMENT = 1;
const TEXT = 3;
const COMMENT = 8;

/** Thrown when the server DOM doesn't match the template at a claim site. The
 * component boundary catches this and recovers by rebuilding via CSR (never silent;
 * see docs/HYDRATION.md §3.5). */
export class HydrationMismatch extends Error {
  constructor(message) {
    super(message);
    this.name = "HydrationMismatch";
  }
}

// ── the hydration flag ────────────────────────────────────────────────────────
// True during the initial hydration pass. A component's connectedCallback reads it
// to decide whether to *adopt* its server children or *build* a fresh subtree — the
// custom-element-as-island coordination (docs/HYDRATION.md §3.4).
//
// Why a flag and not the per-instance `this.firstChild` test: a server-rendered host
// and a client-`createElement`'d host that was handed call-site children both have a
// `firstChild`, so the structural test alone can't tell "adopt the server DOM" from
// "build and slot these children" (it mis-adopts on plain SPA navigation). The flag is
// the unambiguous signal — it is only ever set during the one-shot first-paint pass.
//
// Why it initializes from the DOM sentinel, not `false`: a custom element upgrades — and
// its `connectedCallback` runs the build-vs-adopt switch — the instant its class is
// `customElements.define`d. Framework components imported *eagerly* by the app entry
// (e.g. `<Link>` from `@opentf/web`) are therefore defined and upgraded during the entry
// bundle's evaluation, **before** `mountApp` runs `beginHydration()`. If the flag were
// still `false` then, every server-rendered `<web-link>` would take the *build* arm —
// re-wrapping the server subtree it should have adopted (a silent `<a><a>` double-build)
// — long before the router ever starts hydrating. So the flag is seeded synchronously
// at module load from the server sentinel (`[data-otfw-hydrate]`, stamped only when the
// page shipped adoptable server markup): the deferred entry module evaluates after the
// HTML is parsed, so the sentinel is present, and this module is a transitive dependency
// of every component (via the runtime), so it evaluates before any component's `define`.
// `mountApp` still brackets the pass with `beginHydration`/`endHydration`, and clears the
// flag when it decides *not* to hydrate (no sentinel / empty root), so a CSR mount and
// every subsequent SPA navigation build fresh.
let _hydrating =
  typeof document !== "undefined" && !!document.querySelector("[data-otfw-hydrate]");

/** Is the client mid-hydration right now? */
export function isHydrating() {
  return _hydrating;
}

/**
 * Run `fn` with the hydration flag *cleared*, restoring the prior value (nesting-safe).
 *
 * The build/adopt decision hangs on one module-global flag, but the invariant it must
 * encode is narrower: `isHydrating()` may be true only while the DOM being processed is
 * the server's. The moment a component builds fresh DOM — because its view isn't
 * adoptable (`RebuildIfServerChildren`), or its adopt hit a mismatch and it's recovering,
 * or it's a nested build — that fresh subtree is *not* server-rendered. Its child custom
 * elements upgrade synchronously during `appendChild` inside this build, and if they still
 * saw `isHydrating()` true they'd try to *adopt* content their parent just `createElement`'d
 * → a guaranteed `HydrationMismatch` cascade (a non-adoptable layout would tear the whole
 * page's islands into rebuild-storms). Bracketing every build path with this makes the
 * children build too, matching the DOM they're actually handed. Synchronous only — builds
 * never await — so a plain global save/restore is correct even when builds nest.
 */
export function runBuild(fn) {
  const prev = _hydrating;
  _hydrating = false;
  try {
    return fn();
  } finally {
    _hydrating = prev;
  }
}

/** Run `fn` with the hydration flag set, restoring the prior value (nesting-safe).
 * Synchronous only — for the async first-paint pass use {@link beginHydration} /
 * {@link endHydration}, which span the route module's `import()`. */
export function runHydration(fn) {
  const prev = _hydrating;
  _hydrating = true;
  try {
    return fn();
  } finally {
    _hydrating = prev;
  }
}

// Route modules are code-split (`() => import(...)`), so a route's custom elements are
// defined — and its server-rendered hosts upgrade synchronously — *during* the router's
// `await import()`, before the page `hydrate` factory runs. The flag therefore has to be
// set across that whole async region, which a synchronous `runHydration` can't do; the
// router brackets first paint with these instead. First-paint hydration is a single,
// sequential boot step (no concurrent navigation), so a plain module-global set is safe.

/** Begin the first-paint hydration pass; pair with {@link endHydration}. Set *before*
 * the route module is imported so every server host upgrading at `customElements.define`
 * observes it and adopts (docs/HYDRATION.md §3.4). */
export function beginHydration() {
  _hydrating = true;
}

/** End the first-paint hydration pass — subsequent client navigations build fresh.
 * Also flushes any {@link afterHydration} callbacks queued during the pass. */
export function endHydration() {
  _hydrating = false;
  if (_postHydration) {
    const queued = _postHydration;
    _postHydration = null;
    for (const fn of queued) fn();
  }
}

// Work that must wait until first-paint hydration has *finished*. The motivating case is
// `<Portal>`: it relocates its light-DOM children to a target (usually <body>) on connect,
// but during hydration the portal upgrades — and would move — *before* the owning component
// adopts those children in place. Moving first tears the slot out from under the parent's
// `hydrateSlot` walk, so the portaled content never gets its reactivity wired (dead bindings
// until a later CSR rebuild). Deferring the move until `endHydration` lets the parent adopt
// the server nodes where they sit, then relocate the now-live nodes. See runtime/portal.js.
let _postHydration = null;

/** Run `fn` after first-paint hydration completes (at {@link endHydration}); run it
 * synchronously when not hydrating (a CSR build / SPA navigation). */
export function afterHydration(fn) {
  if (_hydrating) (_postHydration ??= []).push(fn);
  else fn();
}

// ── the serialized props payload (compiler-driven data hydration) ─────────────
// SSG/SSR embeds each island's rich props in a `<script type="application/json"
// id="__otfw_h">`, keyed by the host's `data-h` id (see server/ssg-runtime.js). A
// hydrating component reads its props from here — real JS values (objects, arrays,
// numbers), not lossy string attributes — so it resumes with correct data, with no flash
// and no dependence on a parent walk re-applying props. Read once and cached.
let _payload; // undefined = not yet read; null = none present; else the parsed array

function hydrationPayload() {
  if (_payload === undefined) {
    const el = typeof document !== "undefined" ? document.getElementById("__otfw_h") : null;
    try {
      _payload = el ? JSON.parse(el.textContent || "[]") : null;
    } catch {
      _payload = null;
    }
  }
  return _payload;
}

/**
 * The rich hydration props recorded for host `el` (keyed by its `data-h` id), or `null`
 * when there is no payload for it — a client-`createElement`'d element on SPA navigation,
 * or a plain CSR build. A hydrate-target component constructor reads this to initialize
 * its prop signals, falling back to attributes/defaults when it returns `null`.
 */
export function hydrationProps(el) {
  const data = hydrationPayload();
  if (!data || !el || typeof el.getAttribute !== "function") return null;
  const id = el.getAttribute("data-h");
  if (id == null) return null;
  const entry = data[+id];
  return entry == null ? null : entry;
}

/** Reset the cached payload (tests only — a fresh document between cases). */
export function __resetHydrationPayload() {
  _payload = undefined;
}

// ── the cursor ────────────────────────────────────────────────────────────────

/** A walker over `parent`'s children, positioned at the next node to claim. */
export function cursor(parent) {
  return { node: parent.firstChild };
}

/** Advance past the next node without claiming it (a static text node between
 * dynamic siblings), returning it. The template only emits a skip for a static
 * `ViewNode::Text`, which the server renders as a real text node; assert that so a
 * cursor misalignment surfaces *here* (with a clear message) instead of downstream at
 * an unrelated claim. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function skipNode(cur) {
  const n = cur.node;
  if (!n || n.nodeType !== TEXT) {
    throw new HydrationMismatch(`expected static text, found ${describe(n)}`);
  }
  cur.node = n.nextSibling;
  return n;
}

/**
 * Claim the next node as an element, optionally asserting its tag, and advance the
 * cursor past it. Returns the element so the caller can claim its children with a
 * fresh `cursor(el)`. A wrong/absent node throws {@link HydrationMismatch}.
 */
export function claimElement(cur, tag) {
  const el = cur.node;
  if (!el || el.nodeType !== ELEMENT || (tag && el.tagName.toLowerCase() !== tag.toLowerCase())) {
    throw new HydrationMismatch(`expected <${tag ?? "element"}>, found ${describe(el)}`);
  }
  cur.node = el.nextSibling;
  return el;
}

/**
 * Claim a dynamic text hole delimited by `<!--$-->…<!--/-->`, returning the text node
 * to bind onto (created empty when the server rendered no value), and advance the
 * cursor past the closing marker. Wire reactivity with `bindText(node, fn)` from
 * dom.js — the binding logic is shared with CSR; only the node is adopted, not built.
 *
 * A text hole may hold a *node*, not text: `{expr}` whose value is a JSX element or an
 * array of them (e.g. a code example stored in a data array and rendered `{ex.body}`).
 * The compiler can't distinguish that statically, so it emits the text path for both; the
 * SSG backend renders such a value's markup inline in the hole, and `bindText`'s node arm
 * *rebuilds* it fresh on the client (dom.js) rather than adopting. So any element/comment
 * left inside the hole is server content the client will not reuse — it must be removed
 * here, or it lingers beside the rebuilt node as a duplicate (the whole example appears
 * twice). Only a single text node is a genuine adopt target; strip everything else.
 */
export function claimText(cur) {
  const start = cur.node;
  if (!start || start.nodeType !== COMMENT || start.data !== HOLE_START) {
    throw new HydrationMismatch(`expected a text-hole marker, found ${describe(start)}`);
  }
  let node = start.nextSibling;
  let textNode = null;
  const stray = []; // node-valued-hole server content bindText rebuilds — not adopted
  while (node && !(node.nodeType === COMMENT && node.data === HOLE_END)) {
    const next = node.nextSibling;
    if (node.nodeType === TEXT && !textNode) textNode = node;
    else stray.push(node);
    node = next;
  }
  const end = node; // the `<!--/-->` marker (or null if the markup is malformed)
  for (const n of stray) if (n.parentNode) n.parentNode.removeChild(n);
  if (!textNode) {
    // Empty or node-valued hole: synthesize the anchor bindText will write into.
    textNode = document.createTextNode("");
    (start.parentNode || document).insertBefore(textNode, end);
  }
  cur.node = end ? end.nextSibling : null;
  return textNode;
}

/**
 * Adopt a **JSX-value hole** — a `{expr}` whose value is a JSX-value local (`const x =
 * <T/>`), server-rendered in place between the text-hole markers `<!--$-->…<!--/-->`
 * (docs/HYDRATION.md §3.1, 2.1e). Unlike {@link claimText} — which treats a node-valued
 * hole as *stray* server content, strips it, and lets `bindText` rebuild it fresh (a flash,
 * plus a rebuild cascade through any island the node contains) — this *adopts* the server
 * subtree in place: `adoptFn(inner)` claims it off a cursor seeded just after the opening
 * marker, advancing to the closing marker. A JSX-value local is a `const` bound to a literal,
 * so the hole never reactively re-renders — there is no build/swap arm, only the one-shot
 * adopt. Advances `cur` past `<!--/-->`. Throws {@link HydrationMismatch} on a wrong/absent
 * marker.
 */
export function hydrateHole(cur, adoptFn) {
  const start = cur.node;
  if (!start || start.nodeType !== COMMENT || start.data !== HOLE_START) {
    throw new HydrationMismatch(`expected a text-hole marker, found ${describe(start)}`);
  }
  const inner = { node: start.nextSibling };
  adoptFn(inner); // claims the JSX-value's subtree, advancing `inner` to the end marker
  const end = inner.node;
  if (!end || end.nodeType !== COMMENT || end.data !== HOLE_END) {
    throw new HydrationMismatch(`expected a text-hole end marker, found ${describe(end)}`);
  }
  cur.node = end.nextSibling;
}

/** Claim the `<!--[-->` marker that opens a server-rendered region (list or conditional),
 * advancing the cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimRegionStart(cur) {
  const n = cur.node;
  if (!n || n.nodeType !== COMMENT || n.data !== REGION_START) {
    throw new HydrationMismatch(`expected a region start marker, found ${describe(n)}`);
  }
  cur.node = n.nextSibling;
  return n;
}

/** Claim the `<!--]-->` marker that closes a region and return it — it becomes the
 * reconcile/swap anchor (`hydrateList`/`hydrateChild` insert later nodes before it).
 * Advances the cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimRegionEnd(cur) {
  const n = cur.node;
  if (!n || n.nodeType !== COMMENT || n.data !== REGION_END) {
    throw new HydrationMismatch(`expected a region end marker, found ${describe(n)}`);
  }
  cur.node = n.nextSibling;
  return n;
}

/** Step a component's own adopt walk past its `{children}` slot — claim the
 * `<!--c[-->`…`<!--c]-->` markers and skip the slotted nodes (the parent owns their
 * reactivity, wired separately by {@link hydrateSlot}), leaving them in place. Advances the
 * cursor past the closing marker. Throws {@link HydrationMismatch} on a missing start marker.
 *
 * Returns the slotted nodes. Adoption never captures light-DOM children the way a CSR build
 * does (they are already in place), but a JSX-value local's `build` fallback still closes over
 * the children local — so codegen seeds that binding from this return value, giving a later
 * reactive rebuild the real nodes to re-slot instead of a `ReferenceError`. */
export function skipSlot(cur) {
  const start = cur.node;
  if (!start || start.nodeType !== COMMENT || start.data !== SLOT_START) {
    throw new HydrationMismatch(`expected a children-slot marker, found ${describe(start)}`);
  }
  const slotted = [];
  let n = start.nextSibling;
  while (n && !(n.nodeType === COMMENT && n.data === SLOT_END)) {
    slotted.push(n);
    n = n.nextSibling;
  }
  cur.node = n ? n.nextSibling : null; // step past the `<!--c]-->` end marker
  return slotted;
}

/**
 * Adopt a component's slotted children — the *parent's* JSX, server-rendered inside the
 * component host at its `{children}` slot. The parent owns their reactivity but the
 * component decides where they sit, so the parent locates the slot by its `<!--c[-->` marker
 * within `host` and adopts from the first slotted node via `adoptFn(cursor)`. Independent of
 * when the component upgrades: the markers are static server DOM and adoption only *wires*
 * (never moves) nodes, so it commutes with the component's own `skipSlot`. A missing marker
 * (a rebuilt component, or no children) is a no-op.
 */
export function hydrateSlot(host, adoptFn) {
  const start = findComment(host, SLOT_START);
  if (start) adoptFn({ node: start.nextSibling });
}

/** The first descendant comment of `root` whose data is `data` (tree order). */
function findComment(root, data) {
  const walker = document.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */);
  let n;
  while ((n = walker.nextNode())) if (n.data === data) return n;
  return null;
}

/** A short human description of a node for mismatch messages. */
function describe(node) {
  if (!node) return "nothing";
  if (node.nodeType === ELEMENT) return `<${node.tagName.toLowerCase()}>`;
  if (node.nodeType === TEXT) return `text "${(node.data || "").slice(0, 20)}"`;
  if (node.nodeType === COMMENT) return `comment <!--${node.data}-->`;
  return `node(${node.nodeType})`;
}
