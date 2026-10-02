/** Is the client mid-hydration right now? */
export function isHydrating(): boolean;
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
export function runBuild(fn: any): any;
/** Run `fn` with the hydration flag set, restoring the prior value (nesting-safe).
 * Synchronous only — for the async first-paint pass use {@link beginHydration} /
 * {@link endHydration}, which span the route module's `import()`. */
export function runHydration(fn: any): any;
/** Begin the first-paint hydration pass; pair with {@link endHydration}. Set *before*
 * the route module is imported so every server host upgrading at `customElements.define`
 * observes it and adopts (docs/HYDRATION.md §3.4). */
export function beginHydration(): void;
/** End the first-paint hydration pass — subsequent client navigations build fresh.
 * Also flushes any {@link afterHydration} callbacks queued during the pass. */
export function endHydration(): void;
/** Run `fn` after first-paint hydration completes (at {@link endHydration}); run it
 * synchronously when not hydrating (a CSR build / SPA navigation). */
export function afterHydration(fn: any): void;
/**
 * The rich hydration props recorded for host `el` (keyed by its `data-h` id), or `null`
 * when there is no payload for it — a client-`createElement`'d element on SPA navigation,
 * or a plain CSR build. A hydrate-target component constructor reads this to initialize
 * its prop signals, falling back to attributes/defaults when it returns `null`.
 */
export function hydrationProps(el: any): any;
/** Reset the cached payload (tests only — a fresh document between cases). */
export function __resetHydrationPayload(): void;
/** A walker over `parent`'s children, positioned at the next node to claim. */
export function cursor(parent: any): {
    node: any;
};
/** Advance past the next node without claiming it (a static text node between
 * dynamic siblings), returning it. The template only emits a skip for a static
 * `ViewNode::Text`, which the server renders as a real text node; assert that so a
 * cursor misalignment surfaces *here* (with a clear message) instead of downstream at
 * an unrelated claim. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function skipNode(cur: any): any;
/**
 * Claim the next node as an element, optionally asserting its tag, and advance the
 * cursor past it. Returns the element so the caller can claim its children with a
 * fresh `cursor(el)`. A wrong/absent node throws {@link HydrationMismatch}.
 */
export function claimElement(cur: any, tag: any): any;
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
export function claimText(cur: any): any;
/**
 * Claim the text node of a **raw text** element (`<textarea>`, `<title>`, `<style>`,
 * `<script>`) — the one place a text hole carries no `<!--$-->…<!--/-->` markers.
 *
 * The tokenizer does not parse markup inside these elements, so a marker comment written
 * in there comes back as literal characters (it would be *visible* in a textarea, and the
 * walk would be hunting for a comment node that is really text). The SSG backend
 * therefore emits the content bare (`ssg::raw_text`), and everything written between the
 * tags — however many static and dynamic pieces — arrives as a single text node. That
 * node is the whole content, so it is claimed from the element rather than off a cursor;
 * the compiler only emits this call for the one-hole shape, which `reparse_hazard` is
 * what guarantees. A server-rendered empty value leaves no text node at all, so one is
 * created to bind onto.
 */
export function claimRawText(el: any): any;
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
export function hydrateHole(cur: any, adoptFn: any): void;
/** Claim the `<!--[-->` marker that opens a server-rendered region (list or conditional),
 * advancing the cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimRegionStart(cur: any): any;
/** Claim the `<!--]-->` marker that closes a region and return it — it becomes the
 * reconcile/swap anchor (`hydrateList`/`hydrateChild` insert later nodes before it).
 * Advances the cursor past it. Throws {@link HydrationMismatch} on a wrong/absent node. */
export function claimRegionEnd(cur: any): any;
/** Step a component's own adopt walk past its `{children}` slot — claim the
 * `<!--c[-->`…`<!--c]-->` markers and skip the slotted nodes (the parent owns their
 * reactivity, wired separately by {@link hydrateSlot}), leaving them in place. Advances the
 * cursor past the closing marker. Throws {@link HydrationMismatch} on a missing start marker.
 *
 * Returns the slotted nodes. Adoption never captures light-DOM children the way a CSR build
 * does (they are already in place), but a JSX-value local's `build` fallback still closes over
 * the children local — so codegen seeds that binding from this return value, giving a later
 * reactive rebuild the real nodes to re-slot instead of a `ReferenceError`. */
export function skipSlot(cur: any): any[];
/**
 * The nodes sitting in `host`'s own `{children}` slot in the server DOM, or `null` when the
 * host has no slot markers. Non-destructive — the nodes stay where they are.
 *
 * This is the rescue path for a component that *can't* adopt (a view shape the hydrate
 * backend doesn't support yet, or an adopt walk that hit a mismatch and is recovering). Such
 * a component rebuilds via CSR, and its build captures `this.childNodes` as the call-site
 * children — but on a server-rendered host those children are the *rendered view*, not the
 * slotted content. Clearing first and capturing after (what the generated code used to do)
 * therefore didn't just rebuild the component, it **lost the page content inside it**. Pulling
 * the slot region out first gives the rebuild the real children to re-slot: still a flash,
 * but nothing disappears.
 */
export function slotChildren(host: any): ChildNode[] | null;
/**
 * Adopt a component's slotted children — the *parent's* JSX, server-rendered inside the
 * component host at its `{children}` slot. The parent owns their reactivity but the
 * component decides where they sit, so the parent locates the slot by its `<!--c[-->` marker
 * within `host` and adopts from the first slotted node via `adoptFn(cursor)`. Independent of
 * when the component upgrades: the markers are static server DOM and adoption only *wires*
 * (never moves) nodes, so it commutes with the component's own `skipSlot`. A missing marker
 * (a rebuilt component, or no children) is a no-op.
 */
export function hydrateSlot(host: any, adoptFn: any): void;
/** Comment markers bounding a dynamic text hole in server HTML. */
export const HOLE_START: "$";
export const HOLE_END: "/";
/** Comment markers bounding a variable structural region — a list or a conditional —
 * in server HTML (docs/HYDRATION.md §3.1): `<!--[-->` opens, `<!--]-->` closes. A list
 * holds one item root node per item; a conditional holds the currently rendered branch
 * (or nothing). The closing marker becomes the reconcile/swap anchor on hydration. */
export const REGION_START: "[";
export const REGION_END: "]";
/** Markers bounding a *component's* light-DOM `{children}` slot (docs/HYDRATION.md §3.1,
 * 2.1d) — distinct bytes from the list/conditional region markers so a component's own
 * internal regions never collide with its slot. The slot's content is the *parent's* JSX
 * (server-rendered here), so the parent finds this slot by its `<!--c[-->` marker within the
 * host and adopts the children (its reactivity), while the component steps over the slot.
 *
 * Each marker is **labeled with the owning host's tag** — `<!--c[web-card-8e61e2ff-->` — because
 * slot regions nest: a component that forwards `{children}` into another component
 * (`Card` → `<Link>{children}</Link>`) emits its markers *inside* that component's, and a
 * forwarding parent adds a third pair at the same position. Unlabeled, a component's walk
 * stopped at the first close it met (a nested one) and the parent's slot lookup had to guess
 * by tree order — both wrong in the forwarding shape. The label makes each side's pair exact. */
export const SLOT_START: "c[";
export const SLOT_END: "c]";
/** Thrown when the server DOM doesn't match the template at a claim site. The
 * component boundary catches this and recovers by rebuilding via CSR (never silent;
 * see docs/HYDRATION.md §3.5). */
export class HydrationMismatch extends Error {
    constructor(message: any);
}
