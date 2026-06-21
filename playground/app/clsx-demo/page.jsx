// clsx-style classes: `class={[...]}` accepts strings, conditionals, nested
// arrays, and `{ name: bool }` objects — falsy entries are dropped and the rest
// joined. Toggling the signals re-runs the binding, so the class list is reactive.

export default function ClsxDemoPage() {
  let active = $state(false);
  let danger = $state(false);

  return (
    <div class="space-y-8">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold text-white">Class names (clsx)</h1>
        <p class="text-slate-400 max-w-2xl">
          Pass an array or object to <code>class</code>; the runtime flattens it
          clsx-style. The badge below combines a base string, a ternary, and an
          object condition — all reactive.
        </p>
      </header>

      <section class="space-y-4 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
        <div
          class={[
            "inline-flex rounded-lg px-4 py-3 font-medium transition-colors",
            active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400",
            { "ring-2 ring-red-400": danger },
          ]}
        >
          {active ? "Active" : "Inactive"}
          {danger ? " · danger" : ""}
        </div>

        <div class="flex gap-3">
          <button
            onclick={() => (active = !active)}
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
          >
            Toggle active
          </button>
          <button
            onclick={() => (danger = !danger)}
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
          >
            Toggle danger
          </button>
        </div>

        <pre class="overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-300">{`class={[
  "...base...",
  active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400",
  { "ring-2 ring-red-400": danger },
]}`}</pre>
      </section>
    </div>
  );
}
