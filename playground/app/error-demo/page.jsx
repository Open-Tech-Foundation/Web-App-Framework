// Error-boundary demo: a <Bomb> that throws during render is caught by the
// enclosing <ErrorBoundary>, which shows a fallback (with Retry) instead of taking
// down the page. The sibling Counter keeps working. Defuse the bomb, then Retry to
// watch the boundary rebuild the subtree and recover.

import { ErrorBoundary } from "@opentf/web";
import Bomb from "../components/Bomb";
import Counter from "../components/Counter";
import { bomb } from "../components/bomb-state.js";

export default function ErrorDemoPage() {
  return (
    <div class="space-y-8">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold text-white">Error boundaries</h1>
        <p class="text-slate-400 max-w-2xl">
          A component that throws during render is caught by the nearest{" "}
          <code>&lt;ErrorBoundary&gt;</code>, which swaps in a fallback instead of
          breaking the page. <code>reset()</code> rebuilds the subtree to retry.
        </p>
      </header>

      <section class="space-y-4 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
        <h2 class="text-sm font-bold uppercase tracking-wide text-indigo-400">Caught subtree</h2>
        <ErrorBoundary fallback={(error) => `Caught: ${error.message}`}>
          <Bomb />
        </ErrorBoundary>
        <button
          onclick={() => (bomb.armed = false)}
          class="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-600"
        >
          Defuse the bomb
        </button>
        <p class="text-xs text-slate-500">
          Click <strong>Defuse the bomb</strong>, then <strong>Retry</strong> in the
          fallback above to see the boundary recover.
        </p>
      </section>

      <section class="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
        <h2 class="text-sm font-bold uppercase tracking-wide text-emerald-400">
          Siblings keep working
        </h2>
        <p class="text-sm text-slate-400">
          The crash above is contained — this counter beside it is unaffected.
        </p>
        <Counter label="Still ticking" />
      </section>
    </div>
  );
}
