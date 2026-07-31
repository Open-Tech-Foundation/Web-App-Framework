// Zero-VDOM DOM operations. CSR codegen emits calls into these helpers; they
// also back runtime-driven updates (reactive text/attributes). No virtual DOM,
// no diffing — just direct, fine-grained DOM writes wired to signals.

import { DEV, warnOnce } from "../core/dev.js";
import { effect, scope, signal } from "../core/signals.js";
import { claimRegionEnd, claimRegionStart } from "./hydrate.js";

/** Distinguishes items that carry identity (objects) from interchangeable primitives. */
const hasIdentity = (v) => v !== null && (typeof v === "object" || typeof v === "function");

/** Counts lists so each keyless one warns at most once (see {@link warnKeylessDrift}). */
let listId = 0;

/**
 * Dev-only guard for the index-key fallback (SPEC §5.4.4: "if `key` is missing,
 * `_mapped` falls back to the array index").
 *
 * Index keying matches items by position, so it is only safe while positions are
 * stable. Splice an item out of the middle and every later item shifts up a slot:
 * the reconciler re-points each surviving node at its *neighbour's* data and
 * removes the node at the tail — so the DOM node destroyed is the last one, not
 * the spliced one. Bindings re-render, which hides this for text-only rows, but a
 * row's node identity is its state: focus, scroll offset, uncontrolled input
 * values, media playback, and any custom element's internals all follow the node
 * and so land on the wrong item.
 *
 * Rather than warn on every keyless list (noise: `["a","b"].map(...)` is fine
 * index-keyed forever), warn only once identity has *demonstrably* drifted — an
 * item object that was at one index is now at another. That is exactly the
 * reconcile where the fallback is about to do the wrong thing.
 */
function warnKeylessDrift(id, prevItems, items) {
  const prevIndexOf = new Map();
  for (let i = 0; i < prevItems.length; i++) {
    if (hasIdentity(prevItems[i])) prevIndexOf.set(prevItems[i], i);
  }
  for (let i = 0; i < items.length; i++) {
    const at = prevIndexOf.get(items[i]);
    if (at === undefined || at === i) continue;
    warnOnce(
      `keyless-list:${id}`,
      `A list rendered without \`key\` reordered: an item moved from index ${at} to ${i}.\n` +
        `Without a key, items are matched by position, so the DOM nodes stay put and only their ` +
        `data is re-pointed — per-node state (focus, scroll, inputs, component internals) now ` +
        `belongs to the wrong item, and the node removed is the last one rather than the one you ` +
        `removed.\nFix: give the item a stable key, e.g. \`items.map((item) => <li key={item.id}>…</li>)\`.`,
    );
    return;
  }
}

// Attribute names that must be assigned as JS properties (not setAttribute) for
// correct behavior. Mirrors the set the old runtime relied on (core/constants).
const AS_PROPERTY = new Set([
  "value",
  "checked",
  "selected",
  "disabled",
  "readOnly",
  "className",
  "htmlFor",
  "indeterminate",
]);

// Enumerated attributes: their value is a keyword string ("true"/"false"), not a
// boolean-attribute presence toggle. `draggable={true}` must become
// draggable="true" — draggable="" reads back as the default (false). ARIA states
// behave the same (aria-*="true"/"false").
const ENUMERATED = new Set(["draggable", "spellcheck", "contenteditable"]);

// CSS properties whose numeric values are unitless; every other numeric value
// gets "px" appended (matching React/JSX conventions, so `style={{ width: 8 }}`
// means 8px). Mirrors React's CSSProperty unitless list.
const UNITLESS = new Set([
  "animationIterationCount", "aspectRatio", "borderImageOutset", "borderImageSlice",
  "borderImageWidth", "boxFlex", "boxFlexGroup", "boxOrdinalGroup", "columnCount",
  "columns", "flex", "flexGrow", "flexShrink", "flexOrder", "gridArea", "gridRow",
  "gridRowEnd", "gridRowStart", "gridColumn", "gridColumnEnd", "gridColumnStart",
  "fontWeight", "lineClamp", "lineHeight", "opacity", "order", "orphans", "tabSize",
  "widows", "zIndex", "zoom", "fillOpacity", "floodOpacity", "stopOpacity",
  "strokeDasharray", "strokeDashoffset", "strokeMiterlimit", "strokeOpacity",
  "strokeWidth",
]);

/**
 * Apply a `style` object to an element. Numbers get "px" appended unless the
 * property is unitless; CSS custom properties (`--foo`) go through setProperty;
 * nullish values clear the property. A string value is treated as raw cssText.
 */
export function applyStyle(el, value) {
  if (typeof value === "string") {
    el.style.cssText = value;
    return;
  }
  for (const key in value) {
    const v = value[key];
    if (key.startsWith("--")) {
      el.style.setProperty(key, v == null ? "" : String(v));
    } else if (v == null) {
      el.style[key] = "";
    } else {
      el.style[key] = typeof v === "number" && !UNITLESS.has(key) ? `${v}px` : v;
    }
  }
}

/** Render a reactive value to its text form: null/undefined/false → "". */
export function toText(value) {
  return value == null || value === false ? "" : String(value);
}

/**
 * Compile a static subtree once, then stamp copies of it.
 *
 * CSR codegen hoists one `const t = template("<p …>…</p>")` per distinct static
 * subtree in a module and calls `t()` where it would otherwise have emitted a
 * `createElement` + `setAttribute` + `appendChild` for every node. Parsing happens
 * on the first call and `cloneNode(true)` — a single engine-side copy — on every
 * call, including the first.
 *
 * The parse is deferred rather than done at module scope so importing a compiled
 * module never touches `document`: the hydrate bundle is a browser artifact, but
 * module evaluation order is not something a runtime helper should depend on.
 *
 * The compiler only emits this for markup it has proven the HTML parser rebuilds
 * exactly as `createElement` would (`codegen::static_tree::template_html`) — a
 * template is *not* a general-purpose `innerHTML`, and passing it author markup
 * would reintroduce every reparenting rule that analysis exists to avoid.
 */
export function template(html) {
  let node;
  return () => {
    if (node === undefined) {
      const el = document.createElement("template");
      el.innerHTML = html;
      node = el.content.firstChild;
    }
    return node.cloneNode(true);
  };
}

/** Sentinel for "nothing written yet" — distinct from any real attribute value. */
const UNSET = Symbol("unset");

/** A value safe to compare by identity for write elision (no internal mutation). */
const isPrimitive = (v) =>
  v === null || (typeof v !== "object" && typeof v !== "function");

/**
 * clsx-style class normalization. Falsy entries are skipped; strings/numbers are
 * kept; arrays recurse; objects contribute the keys whose values are truthy. Lets
 * JSX write `class={["btn", active && "on", { lg: size === "lg" }]}`.
 */
export function clsx(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (const v of value) {
      const s = clsx(v);
      if (s) parts.push(s);
    }
    return parts.join(" ");
  }
  if (typeof value === "object") {
    const parts = [];
    for (const k in value) if (value[k]) parts.push(k);
    return parts.join(" ");
  }
  return "";
}

/**
 * Apply a single static prop/attribute. Handles `style` objects, `on*` event
 * handlers, property-backed attributes, and boolean/nullish removal; everything
 * else falls back to `setAttribute`.
 */
export function setAttr(el, name, value) {
  if (name === "style" && value && (typeof value === "object" || typeof value === "string")) {
    applyStyle(el, value);
    return;
  }
  if (name === "class" && value && typeof value === "object") {
    const c = clsx(value); // array/object form → a normalized class string
    if (c) el.setAttribute("class", c);
    else el.removeAttribute("class");
    return;
  }
  if (name.startsWith("on") && typeof value === "function") {
    el[name.toLowerCase()] = value;
    return;
  }
  if (AS_PROPERTY.has(name)) {
    el[name] = value;
    return;
  }
  if (ENUMERATED.has(name) || name.startsWith("aria-")) {
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? "true" : value === false ? "false" : String(value));
    return;
  }
  if (value == null || value === false) {
    el.removeAttribute(name);
    return;
  }
  if (value === true) {
    el.setAttribute(name, "");
    return;
  }
  el.setAttribute(name, String(value));
}

/**
 * Apply a named prop to a *child component* element. Set it as a property when the
 * element exposes one (custom-element prop setters, `value`, `checked`, …) so rich
 * values (objects, signals) reach the component's setter; otherwise fall back to an
 * attribute so plain ones (`class`, `data-*`, `aria-*`) still land correctly. This
 * mirrors how JSX libraries target custom elements. If the element is not yet
 * upgraded `name in el` is false, so the value lands as an attribute and the
 * component picks it up from `getAttribute` when it upgrades.
 */
export function setProp(el, name, value) {
  // A component prop must land as a *property* (carrying the rich value), never a
  // stringified attribute. A server-parsed custom element that a parent's adopt walk
  // reaches while it is still inert — its own `customElements.define`-driven upgrade
  // hasn't run yet (synchronous upgrades fire in document order, so a parent upgrades
  // and runs this before its later-in-DOM children) — has no accessors, so `name in el`
  // is false. Falling back to `setAttr` would stringify an object to "[object Object]"
  // and, via `attributeChangedCallback`, clobber the child's payload-hydrated signal —
  // flipping conditional branches and desyncing the adopt walk. Force the pending upgrade
  // first so the property setter exists; it's a no-op for already-upgraded or non-custom
  // elements. (A client CSR build creates already-upgraded instances, so this never fires
  // there.)
  if (
    !(name in el) &&
    el.tagName &&
    el.tagName.includes("-") &&
    typeof customElements !== "undefined" &&
    customElements.get(el.tagName.toLowerCase())
  ) {
    customElements.upgrade(el);
  }
  if (name in el) el[name] = value;
  else setAttr(el, name, value);
}

/**
 * Apply every own enumerable key of `obj` to `el` (`<div {...obj}/>`, SPEC §5.5).
 * `asProps` sets element properties (for components) instead of attributes (for
 * host elements). Keys are applied in object order; the caller wraps this in an
 * effect so a reactive source re-applies.
 */
export function spread(el, obj, asProps) {
  if (!obj) return;
  for (const k in obj) {
    if (asProps) el[k] = obj[k];
    else setAttr(el, k, obj[k]);
  }
}

/**
 * Wire a text node to a reactive expression. Primitive values update the text in
 * place; a DOM node (or array of them) — e.g. JSX stored as a value, `{iconMap[k]}`
 * — is inserted before the text node, which stays as a stable anchor. Returns the
 * effect disposer so the caller (component lifecycle) can stop updates.
 */
export function bindText(node, fn) {
  let inserted = [];
  let lastText; // undefined sentinel — toText() never returns undefined
  let lastNodeValue; // the node/array/marker currently rendered, for the re-run check
  return effect(() => {
    const value = fn();

    // A server `{__html}` marker (see `isHtmlMarker`) renders as the nodes it describes —
    // and it is immutable, so re-running with the same marker keeps what is already there
    // instead of re-parsing it (which would tear down and re-upgrade any island inside).
    if (isHtmlMarker(value) && value === lastNodeValue) return;

    // Primitive text: the common case. Skip the write when the rendered string
    // is unchanged (a shared dependency can re-run this effect with the same
    // result), so unchanged text nodes don't churn.
    if (!(value instanceof Node) && !Array.isArray(value) && !isHtmlMarker(value)) {
      const text = toText(value);
      if (text === lastText) return;
      lastText = text;
      lastNodeValue = undefined;
      for (const n of inserted) {
        if (n.parentNode) n.parentNode.removeChild(n);
      }
      inserted = [];
      node.data = text;
      return;
    }

    // Node / array / marker value (e.g. JSX stored as a value): insert before the stable
    // text anchor. Reset the text memo so a later primitive value re-applies.
    lastText = undefined;
    lastNodeValue = value;
    for (const n of inserted) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    inserted = [];
    node.data = "";
    const parent = node.parentNode;
    if (parent) {
      for (const n of toNodes(value)) {
        parent.insertBefore(n, node);
        inserted.push(n);
      }
    }
  });
}

/**
 * Wire an element attribute/prop to a reactive expression. Returns the disposer.
 *
 * No-op writes are elided for primitive values: when the expression recomputes
 * to the same primitive it last wrote, the DOM write is skipped. This matters
 * when many elements share one dependency — e.g. a keyed list where every row's
 * `class={selected === row.id ? "danger" : ""}` subscribes to a single
 * `selected` signal. Changing it re-runs every row's effect, but only the two
 * rows whose class actually changes should touch the DOM; the rest would
 * otherwise call `setAttribute` with an unchanged value and trigger needless
 * style invalidation. Object values (style/class objects, spreads) may have
 * mutated internally, so they are always re-applied.
 */
export function bindAttr(el, name, fn) {
  let last = UNSET;
  return effect(() => {
    const value = fn();
    if (isPrimitive(value) && Object.is(value, last)) return;
    last = value;
    setAttr(el, name, value);
  });
}

/**
 * Is this the server's stand-in for a JSX value — `{ __html }`?
 *
 * A JSX value the server can't hand over as a DOM node (a component prop whose value is
 * an element, `<Tabs tabs={[{ content: <CodeBlock/> }]} />`, or JSX embedded in a list's
 * data) is rendered to its HTML and crosses to the client inside the hydration payload as
 * this marker — `ssgText` splices it raw on the server, and the client has to do the same
 * or it would stringify to `[object Object]` in the middle of the page.
 */
const isHtmlMarker = (v) => v !== null && typeof v === "object" && typeof v.__html === "string";

/** Parse a trusted server-rendered HTML string into the nodes it describes. */
function htmlToNodes(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return [...tpl.content.childNodes];
}

/** Flatten a reactive child value into DOM nodes: nodes pass through, arrays
 * recurse, nullish/booleans render nothing, `{__html}` markers are parsed back into
 * the nodes the server rendered, and primitives become text nodes. */
function toNodes(value) {
  if (value == null || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) for (const n of toNodes(v)) out.push(n);
    return out;
  }
  if (value instanceof Node) return [value];
  if (isHtmlMarker(value)) return htmlToNodes(value.__html);
  return [document.createTextNode(String(value))];
}

/**
 * Wire a dynamic child region (conditional/element-valued holes like
 * `{cond && <p/>}` or `{cond ? <a/> : <b/>}`) to a reactive expression. The
 * region is delimited by `anchor` (a comment); on every change the previous
 * nodes are replaced with the new ones, inserted just before the anchor.
 * Returns the effect disposer.
 */
export function bindChild(anchor, fn) {
  return childEffect(anchor, fn, [], false);
}

/**
 * Hydrate a server-rendered conditional / dynamic-node region (docs/HYDRATION.md §3.1,
 * 2.1b). The cursor `cur` is at the `<!--[-->` marker; between it and `<!--]-->` sits the
 * one branch the server rendered (or nothing). `adoptFn(cur)` evaluates the same branch
 * expression with *adopt* calls — only the taken branch's builder runs, claiming its nodes
 * off the shared cursor — so the adopted nodes become the region's initial content with no
 * rebuild. `buildFn()` is the CSR version (build calls) the effect swaps to when a later
 * reactive change selects a different branch. The closing `<!--]-->` is the swap anchor.
 * Returns the effect disposer.
 *
 * `depsFn()` is the same branch expression with **every branch replaced by `null`**. The
 * region effect has to run something on first paint to subscribe to the deps it should react
 * to — the *condition* — but running the real `buildFn` there constructs a whole subtree only
 * to discard it, and when a branch re-slots the component's `{children}`, `appendChild`
 * **moves** those live server nodes into the throwaway tree, silently emptying the slot (the
 * `<Card>` → `<Link>{children}</Link>` shape lost its children this way). Evaluating the
 * condition with null branches subscribes to exactly the same reads without building anything;
 * reactivity *inside* a branch is wired by that branch's own bindText/bindAttr effects, so it
 * is not a dependency of this region. Older codegen passes no `depsFn` — fall back to `buildFn`.
 */
export function hydrateChild(cur, adoptFn, buildFn, depsFn) {
  claimRegionStart(cur);
  // Adopt inside a scope so the adopted branch owns its bindings' effects; the
  // region disposes it when a reactive change swaps the branch out.
  const adoptedScope = scope(() => toNodes(adoptFn(cur)));
  const anchor = claimRegionEnd(cur);
  // Seed with the adopted nodes and skip the first effect run's DOM write: the branch is
  // already in place; from the second run on it swaps normally.
  return childEffect(anchor, buildFn, adoptedScope.result, true, adoptedScope, depsFn || buildFn);
}

/** The child-region effect shared by {@link bindChild} (empty seed, no skip) and
 * {@link hydrateChild} (seeded with adopted nodes, first DOM write skipped). On each run
 * the previous nodes are replaced with the new ones, inserted before `anchor`; the
 * previous branch's scope is disposed so its bindings' effects don't outlive it. */
function childEffect(anchor, fn, current, skipFirst, currentScope = null, firstFn = fn) {
  let first = skipFirst;
  const disposeEffect = effect(() => {
    // Build in a scope: the branch's nested bindings (text/attr/list effects)
    // belong to this run and are disposed when the branch is replaced.
    // On a hydration first run this evaluates `firstFn` — the condition with null
    // branches — which subscribes the region without constructing (or stealing) DOM.
    const built = scope(() => toNodes((first ? firstFn : fn)()));
    if (first) {
      first = false;
      // Hydration first run subscribes the region effect only; anything the discarded
      // run did create must not stay live alongside the adopted branch.
      built.dispose();
      return; // keep the adopted DOM on first paint
    }
    const next = built.result;
    const host = anchor.parentNode;
    for (const n of current) {
      if (n.parentNode === host) host.removeChild(n);
    }
    if (host) for (const n of next) host.insertBefore(n, anchor);
    if (currentScope) currentScope.dispose();
    currentScope = built;
    current = next;
  });
  return () => {
    disposeEffect();
    if (currentScope) currentScope.dispose();
  };
}

/**
 * Render a keyed list (`array.map(...)`, SPEC §5.4.4) into `parent`, reconciling
 * by key on every change to `sourceFn`'s dependencies.
 *
 * - `sourceFn()` returns the current array (plain data).
 * - `renderItem(itemSignal, index)` builds a node for a new item; the item's
 *   value is a signal so per-item bindings update fine-grained on data changes.
 * - `keyFn(item, index)` returns a stable key; falls back to `index` when omitted.
 *
 * Returns the effect disposer (stops reconciliation; used by component cleanup).
 */
export function bindList(parent, sourceFn, renderItem, keyFn) {
  const anchor = document.createComment("");
  parent.appendChild(anchor);
  return reconcileList(anchor, sourceFn, renderItem, keyFn, new Map(), []);
}

/**
 * Hydrate a server-rendered list region (docs/HYDRATION.md §3.1/2.1). The cursor `cur` is
 * positioned at the `<!--[-->` marker; the region holds one root node per item, then
 * `<!--]-->`. Adopts each item's server node via `adoptItem(cur, itemSignal, index)`
 * (claiming off the shared cursor, which advances to the next item), seeds the reconcile
 * cache with the adopted `{sig, node}` pairs, then wires the *same* keyed-reconcile effect
 * `bindList` uses — so a later data change builds/moves/removes with no first-paint flash.
 * The closing `<!--]-->` becomes the reconcile anchor. Returns the effect disposer.
 */
export function hydrateList(cur, sourceFn, adoptItem, renderItem, keyFn) {
  claimRegionStart(cur);
  const data = sourceFn();
  const items = Array.isArray(data) ? data : [];
  const cache = new Map();
  const prevKeys = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const key = keyFn ? keyFn(item, index) : index;
    const sig = signal(item);
    // Adopt inside a scope so the item owns its bindings' effects; eviction
    // disposes them (same ownership as CSR-built items in reconcileList).
    const s = scope(() => adoptItem(cur, sig, index)); // claims one item subtree off `cur`
    cache.set(key, { sig, node: s.result, dispose: s.dispose });
    prevKeys.push(key);
  }
  const anchor = claimRegionEnd(cur);
  // The seeded effect's first run re-reads the same data: every key hits the cache, so it
  // subscribes for future updates without mutating the already-correct adopted DOM.
  return reconcileList(anchor, sourceFn, renderItem, keyFn, cache, prevKeys);
}

/**
 * The keyed-reconcile effect shared by {@link bindList} (empty seed) and
 * {@link hydrateList} (seeded from adopted nodes). `anchor` is the trailing comment new
 * items are inserted before; `cache` (key → `{sig, node}`) and `prevKeys` (keys in DOM
 * order) carry reconciliation state across runs. Returns the effect disposer.
 */
function reconcileList(anchor, sourceFn, renderItem, keyFn, cache, prevKeys) {
  // Dev-only state for the keyless-drift guard: the previous run's items, so a
  // reorder can be spotted by identity.
  const id = DEV && !keyFn ? listId++ : -1;
  let prevItems = [];
  const disposeEffect = effect(() => {
    const data = sourceFn();
    const items = Array.isArray(data) ? data : [];
    if (DEV && !keyFn) {
      warnKeylessDrift(id, prevItems, items);
      prevItems = items;
    }
    const next = new Map();
    const nodes = new Array(items.length);
    const newKeys = new Array(items.length);
    // For each new position, the node's index in the *previous* order, or -1 if
    // it is newly created. Drives the LIS-based minimal move below.
    const prevIndex = new Array(items.length);

    const prevPos = new Map();
    for (let i = 0; i < prevKeys.length; i++) prevPos.set(prevKeys[i], i);

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const key = keyFn ? keyFn(item, index) : index;
      let entry = cache.get(key);
      if (entry) {
        cache.delete(key);
        entry.sig.value = item; // fine-grained per-item update (no-op if unchanged)
        prevIndex[index] = prevPos.has(key) ? prevPos.get(key) : -1;
      } else {
        const sig = signal(item);
        // Build inside a scope: the item owns its bindings' effects, so
        // evicting it detaches them from shared signals (e.g. a selection
        // signal every row's class reads). Without this every discarded row
        // leaves a zombie effect that all later writes keep re-running.
        const s = scope(() => renderItem(sig, index));
        entry = { sig, node: s.result, dispose: s.dispose };
        prevIndex[index] = -1;
      }
      next.set(key, entry);
      newKeys[index] = key;
      nodes[index] = entry.node;
    }

    // Remove nodes whose keys disappeared, and dispose their bindings.
    for (const entry of cache.values()) {
      if (entry.dispose) entry.dispose();
      if (entry.node.parentNode) entry.node.parentNode.removeChild(entry.node);
    }
    cache = next;
    prevKeys = newKeys;

    // Minimal-move placement. Nodes whose previous indices form the longest
    // increasing subsequence are already in relative order and stay put; only
    // the rest (and newly created nodes) are inserted. A 2-row swap moves 2
    // nodes, not the ~n nodes a naive "fix every wrong nextSibling" pass would
    // cascade into. Walk back to front so each insertion's reference node is
    // already in its final position.
    const keep = longestIncreasingRun(prevIndex);
    const host = anchor.parentNode;
    if (!host) return; // anchor detached (list torn down) — nothing to place
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (keep.has(i)) continue;
      const ref = i + 1 < nodes.length ? nodes[i + 1] : anchor;
      if (nodes[i].nextSibling !== ref) host.insertBefore(nodes[i], ref);
    }
  });
  return () => {
    disposeEffect();
    for (const entry of cache.values()) {
      if (entry.dispose) entry.dispose();
    }
    cache.clear();
  };
}

/**
 * Indices `i` of `seq` whose values form a longest strictly-increasing
 * subsequence (patience sorting, O(n log n)). Entries equal to -1 (new nodes)
 * are excluded — they always need insertion. Returned as a Set for O(1) lookup
 * during placement; these are the nodes that can stay where they are.
 */
function longestIncreasingRun(seq) {
  const piles = []; // piles[k] = index of the smallest tail of a length-(k+1) run
  const prev = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i];
    if (v < 0) continue; // new node — never part of the stable run
    let lo = 0;
    let hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[piles[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = piles[lo - 1];
    piles[lo] = i;
  }
  const keep = new Set();
  let k = piles.length ? piles[piles.length - 1] : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k];
  }
  return keep;
}
