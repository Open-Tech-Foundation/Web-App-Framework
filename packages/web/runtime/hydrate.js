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

/** Comment markers bounding a variable list region in server HTML (docs/HYDRATION.md
 * §3.1): `<!--[-->` opens, `<!--]-->` closes, with one item root node between them. */
export const LIST_START = "[";
export const LIST_END = "]";

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
let _hydrating = false;

/** Is the client mid-hydration right now? */
export function isHydrating() {
  return _hydrating;
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

/** End the first-paint hydration pass — subsequent client navigations build fresh. */
export function endHydration() {
  _hydrating = false;
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
 */
export function claimText(cur) {
  const start = cur.node;
  if (!start || start.nodeType !== COMMENT || start.data !== HOLE_START) {
    throw new HydrationMismatch(`expected a text-hole marker, found ${describe(start)}`);
  }
  let node = start.nextSibling;
  let textNode = null;
  while (node && !(node.nodeType === COMMENT && node.data === HOLE_END)) {
    if (node.nodeType === TEXT && !textNode) textNode = node;
    node = node.nextSibling;
  }
  const end = node; // the `<!--/-->` marker (or null if the markup is malformed)
  if (!textNode) {
    // Empty hole (`<!--$--><!--/-->`): synthesize the anchor bindText will write into.
    textNode = document.createTextNode("");
    (start.parentNode || document).insertBefore(textNode, end);
  }
  cur.node = end ? end.nextSibling : null;
  return textNode;
}

/** Claim the `<!--[-->` marker that opens a server-rendered list region, advancing the
 * cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimListStart(cur) {
  const n = cur.node;
  if (!n || n.nodeType !== COMMENT || n.data !== LIST_START) {
    throw new HydrationMismatch(`expected a list-region start marker, found ${describe(n)}`);
  }
  cur.node = n.nextSibling;
  return n;
}

/** Claim the `<!--]-->` marker that closes a list region and return it — it becomes the
 * reconcile anchor (`hydrateList` inserts later-added items before it). Advances the
 * cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimListEnd(cur) {
  const n = cur.node;
  if (!n || n.nodeType !== COMMENT || n.data !== LIST_END) {
    throw new HydrationMismatch(`expected a list-region end marker, found ${describe(n)}`);
  }
  cur.node = n.nextSibling;
  return n;
}

/** A short human description of a node for mismatch messages. */
function describe(node) {
  if (!node) return "nothing";
  if (node.nodeType === ELEMENT) return `<${node.tagName.toLowerCase()}>`;
  if (node.nodeType === TEXT) return `text "${(node.data || "").slice(0, 20)}"`;
  if (node.nodeType === COMMENT) return `comment <!--${node.data}-->`;
  return `node(${node.nodeType})`;
}
