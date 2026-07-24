import Tree from "./Tree.jsx";

// The now-adoptable docs-layout idiom (Phase 2.1e): a *plain* `const body = <jsx>` value
// referenced from a conditional root — the exact shape (DocsLayout) that first broke docs-site
// hydration. The hydrate backend now emits it as a dual `{ build, adopt }` object: the `{body}`
// hole adopts the server subtree in place (`hydrateHole`) and the bare `: body` branch adopts
// off the region cursor. So this component ADOPTS on first paint instead of rebuilding.
//
// It wraps a <Tree> (→ eagerly-defined <Link> islands) to prove the adoption threads through
// nested islands: they must adopt their server <a> in place — no flash, no double-built anchor.
//
// It also takes a light-DOM `{children}` slot *inside* the value local, because the real
// DocsLayout does (`<article class="otfw-prose">{props.children}</article>`) — and that slot is
// what the first cut of 2.1e missed. The value local's CSR `build` fn re-slots the children
// local, but only the sibling `__build` closure declared it, so the adopt branch threw
// `ReferenceError: __children is not defined` and killed the render. Seeding it from `skipSlot`
// then exposed the follow-on: `hydrateChild` evaluates the build template once just to subscribe
// to its deps and discards the result, so rebuilding there `appendChild`s the *live* slotted
// nodes into a throwaway tree and silently empties the slot. Hence the adopt-root memo — the
// first `build()` after an adopt returns the adopted node untouched.
export default function Framed({ node, framed, children }) {
  // The slot sits *before* the tree deliberately: `hydrateSlot` locates a component's slotted
  // content by the first `<!--c[-->` marker under the host, and <Tree>'s nested <Link> islands
  // emit slot markers of their own — put the tree first and the parent's adopt walk starts on
  // a Link's dot instead of this slot (a separate, pre-existing limitation of that lookup).
  const body = (
    <div class="framed-body">
      <div class="framed-slot">{children}</div>
      <ul class="framed-tree">
        <Tree node={node} />
      </ul>
    </div>
  );
  return framed ? (
    <section class="framed-section">
      <h3 class="framed-title">Framed</h3>
      {body}
    </section>
  ) : (
    body
  );
}
