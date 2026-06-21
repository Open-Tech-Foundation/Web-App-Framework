// Event model demo — the hybrid: callback props for direct parent communication,
// dispatched CustomEvents for subscribers, and `on*:mod` listener modifiers
// (capture / passive / once) compiling to addEventListener with options.

import StarRating from "../components/StarRating";

export default function EventsDemoPage() {
  let viaCallback = $state(0);
  let viaEvent = $state(0);
  let onceCount = $state(0);
  let lastKey = $state("—");

  return (
    <div class="space-y-8">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold text-white">Event model</h1>
        <p class="text-slate-400 max-w-2xl">
          A component reaches its parent two ways at once. A <strong>callback prop</strong>{" "}
          (<code>onChange</code>) is a direct call; a <strong>dispatched event</strong> bubbles
          a <code>CustomEvent</code> that any subscriber catches with{" "}
          <code>onRate:listen</code>. Listener modifiers add{" "}
          <code>capture</code>/<code>passive</code>/<code>once</code> options.
        </p>
      </header>

      <section class="space-y-4 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
        <h2 class="text-sm font-bold uppercase tracking-wide text-indigo-400">
          Callback prop + dispatched event
        </h2>
        <StarRating
          onChange={(n) => (viaCallback = n)}
          onRate:listen={(e) => (viaEvent = e.detail)}
        />
        <div class="flex gap-6 font-mono text-sm">
          <span class="text-slate-400">
            onChange callback: <span class="text-emerald-400">{viaCallback}</span>
          </span>
          <span class="text-slate-400">
            onRate:listen event: <span class="text-sky-400">{viaEvent}</span>
          </span>
        </div>
      </section>

      <section class="space-y-4 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
        <h2 class="text-sm font-bold uppercase tracking-wide text-indigo-400">
          Listener modifiers
        </h2>
        <div class="flex flex-wrap gap-3">
          <button
            onclick:once={() => (onceCount += 1)}
            class="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-600"
          >
            :once — fires {onceCount} time(s)
          </button>
          <input
            onkeydown:passive={(e) => (lastKey = e.key)}
            placeholder="type here (:passive keydown)"
            class="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <span class="self-center font-mono text-sm text-slate-400">
            last key: <span class="text-sky-400">{lastKey}</span>
          </span>
        </div>
        <p class="text-xs text-slate-500">
          <code>:once</code> auto-removes after one fire; the listeners are torn down on
          unmount via the component's cleanup list.
        </p>
      </section>
    </div>
  );
}
