import Tree from "./Tree.jsx";

// Reproduces the shape that broke docs-site hydration (DocsLayout): a `const x = <jsx>`
// value referenced from a conditional root. Binding JSX to a variable makes the hydrate
// backend unable to adopt this view, so the component is `RebuildIfServerChildren` — on
// first paint it discards the server DOM and CSR-rebuilds. The regression: that rebuild
// runs while `isHydrating()` is still true, so the child islands it creates (<Tree> →
// <Link>, real Custom Elements) used to upgrade and try to *adopt* content this component
// had just built from scratch — a HydrationMismatch cascade. The `runBuild` guard clears
// the flag around the build so the whole fresh subtree builds instead. This fixture makes
// the e2e fail loudly (mismatch errors + double-built <a>) if that guard regresses.
export default function Panel({ node, framed }) {
  const body = (
    <div class="panel-body">
      <ul class="panel-tree">
        <Tree node={node} />
      </ul>
    </div>
  );
  return framed ? (
    <section class="panel-framed">
      <h3 class="panel-title">Panel</h3>
      {body}
    </section>
  ) : (
    body
  );
}
