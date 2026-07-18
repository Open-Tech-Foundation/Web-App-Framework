import Tree from "./Tree.jsx";

// The now-adoptable docs-layout idiom (Phase 2.1e): a *plain* `const body = <jsx>` value
// referenced from a conditional root — the exact shape (DocsLayout) that first broke docs-site
// hydration. The hydrate backend now emits it as a dual `{ build, adopt }` object: the `{body}`
// hole adopts the server subtree in place (`hydrateHole`) and the bare `: body` branch adopts
// off the region cursor. So this component ADOPTS on first paint instead of rebuilding.
//
// It wraps a <Tree> (→ eagerly-defined <Link> islands) to prove the adoption threads through
// nested islands: they must adopt their server <a> in place — no flash, no double-built anchor.
export default function Framed({ node, framed }) {
  const body = (
    <div class="framed-body">
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
