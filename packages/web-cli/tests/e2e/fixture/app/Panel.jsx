import Tree from "./Tree.jsx";

// A *deliberately non-adoptable* island, kept as the `runBuild` cascade guard. The JSX value
// lives inside an object literal (`parts.body`) — a shape the hydrate backend cannot claim as
// one positional node — so this component stays `RebuildIfServerChildren` and, on first paint,
// discards the server DOM and CSR-rebuilds. The regression that guards: that rebuild runs while
// `isHydrating()` is still true, so the child islands it creates (<Tree> → <Link>, real Custom
// Elements) used to upgrade and try to *adopt* content this component had just built from
// scratch — a HydrationMismatch cascade. The `runBuild` guard clears the flag around the build
// so the whole fresh subtree builds instead. This fixture makes the e2e fail loudly (mismatch
// errors + double-built <a>) if that guard regresses.
//
// (The *plain* `const body = <jsx>` idiom that first broke the docs site now ADOPTS — Phase
// 2.1e; see <Framed> for that case. This keeps a genuinely non-adoptable island so the guard
// stays exercised regardless.)
export default function Panel({ node, framed }) {
  const parts = {
    body: (
      <div class="panel-body">
        <ul class="panel-tree">
          <Tree node={node} />
        </ul>
      </div>
    ),
  };
  return framed ? (
    <section class="panel-framed">
      <h3 class="panel-title">Panel</h3>
      {parts.body}
    </section>
  ) : (
    parts.body
  );
}
