// A component that throws during render while "armed" — to demonstrate that a
// throwing descendant is caught by the nearest <ErrorBoundary>. Defuse it (page
// button sets bomb.armed = false), then Retry to see the boundary recover.

import { bomb } from "./bomb-state.js";

export default function Bomb() {
  if (bomb.armed) {
    throw new Error("Bomb exploded during render!");
  }
  return (
    <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-300">
      ✅ Defused — this component rendered cleanly.
    </div>
  );
}
