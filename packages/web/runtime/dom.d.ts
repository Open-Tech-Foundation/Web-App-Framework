/**
 * Apply a `style` object to an element. Numbers get "px" appended unless the
 * property is unitless; CSS custom properties (`--foo`) go through setProperty;
 * nullish values clear the property. A string value is treated as raw cssText.
 */
export function applyStyle(el: any, value: any): void;
/** Render a reactive value to its text form: null/undefined/false → "". */
export function toText(value: any): string;
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
export function template(html: any): () => any;
/**
 * clsx-style class normalization. Falsy entries are skipped; strings/numbers are
 * kept; arrays recurse; objects contribute the keys whose values are truthy. Lets
 * JSX write `class={["btn", active && "on", { lg: size === "lg" }]}`.
 */
export function clsx(value: any): any;
/**
 * Apply a single static prop/attribute. Handles `style` objects, `on*` event
 * handlers, property-backed attributes, and boolean/nullish removal; everything
 * else falls back to `setAttribute`.
 */
export function setAttr(el: any, name: any, value: any): void;
/**
 * Apply a named prop to a *child component* element. Set it as a property when the
 * element exposes one (custom-element prop setters, `value`, `checked`, …) so rich
 * values (objects, signals) reach the component's setter; otherwise fall back to an
 * attribute so plain ones (`class`, `data-*`, `aria-*`) still land correctly. This
 * mirrors how JSX libraries target custom elements. If the element is not yet
 * upgraded `name in el` is false, so the value lands as an attribute and the
 * component picks it up from `getAttribute` when it upgrades.
 */
export function setProp(el: any, name: any, value: any): void;
/**
 * Apply every own enumerable key of `obj` to `el` (`<div {...obj}/>`, SPEC §5.5).
 * `asProps` sets element properties (for components) instead of attributes (for
 * host elements). Keys are applied in object order; the caller wraps this in an
 * effect so a reactive source re-applies.
 */
export function spread(el: any, obj: any, asProps: any): void;
/**
 * Wire a text node to a reactive expression. Primitive values update the text in
 * place; a DOM node (or array of them) — e.g. JSX stored as a value, `{iconMap[k]}`
 * — is inserted before the text node, which stays as a stable anchor. Returns the
 * effect disposer so the caller (component lifecycle) can stop updates.
 */
export function bindText(node: any, fn: any): () => void;
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
export function bindAttr(el: any, name: any, fn: any): () => void;
/**
 * Wire a dynamic child region (conditional/element-valued holes like
 * `{cond && <p/>}` or `{cond ? <a/> : <b/>}`) to a reactive expression. The
 * region is delimited by `anchor` (a comment); on every change the previous
 * nodes are replaced with the new ones, inserted just before the anchor.
 * Returns the effect disposer.
 */
export function bindChild(anchor: any, fn: any): () => void;
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
export function hydrateChild(cur: any, adoptFn: any, buildFn: any, depsFn: any): () => void;
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
export function bindList(parent: any, sourceFn: any, renderItem: any, keyFn: any): () => void;
/**
 * Hydrate a server-rendered list region (docs/HYDRATION.md §3.1/2.1). The cursor `cur` is
 * positioned at the `<!--[-->` marker; the region holds one root node per item, then
 * `<!--]-->`. Adopts each item's server node via `adoptItem(cur, itemSignal, index)`
 * (claiming off the shared cursor, which advances to the next item), seeds the reconcile
 * cache with the adopted `{sig, node}` pairs, then wires the *same* keyed-reconcile effect
 * `bindList` uses — so a later data change builds/moves/removes with no first-paint flash.
 * The closing `<!--]-->` becomes the reconcile anchor. Returns the effect disposer.
 */
export function hydrateList(cur: any, sourceFn: any, adoptItem: any, renderItem: any, keyFn: any): () => void;
