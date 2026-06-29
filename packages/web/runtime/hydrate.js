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
let _hydrating = false;

/** Is the client mid-hydration right now? */
export function isHydrating() {
  return _hydrating;
}

/** Run `fn` with the hydration flag set, restoring the prior value (nesting-safe). */
export function runHydration(fn) {
  const prev = _hydrating;
  _hydrating = true;
  try {
    return fn();
  } finally {
    _hydrating = prev;
  }
}

// ── the cursor ────────────────────────────────────────────────────────────────

/** A walker over `parent`'s children, positioned at the next node to claim. */
export function cursor(parent) {
  return { node: parent.firstChild };
}

/** Advance past the next node without claiming it (a static text node between
 * dynamic siblings), returning it. */
export function skipNode(cur) {
  const n = cur.node;
  cur.node = n ? n.nextSibling : null;
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

/** A short human description of a node for mismatch messages. */
function describe(node) {
  if (!node) return "nothing";
  if (node.nodeType === ELEMENT) return `<${node.tagName.toLowerCase()}>`;
  if (node.nodeType === TEXT) return `text "${(node.data || "").slice(0, 20)}"`;
  if (node.nodeType === COMMENT) return `comment <!--${node.data}-->`;
  return `node(${node.nodeType})`;
}
