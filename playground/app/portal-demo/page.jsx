// Portal demo: a modal rendered into <body> to escape a clipping ancestor,
// contrasted with a native <dialog> (the top layer) — which for modals
// specifically is the simpler, built-in alternative to a portal.

import { Portal } from "@opentf/web";

export default function PortalDemoPage() {
  let open = $state(false);
  const dialogRef = $ref();

  return (
    <div class="space-y-8">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold text-white">Portals</h1>
        <p class="text-slate-400 max-w-2xl">
          <code>&lt;Portal&gt;</code> renders its children into another DOM location
          (default <code>&lt;body&gt;</code>) so they escape an ancestor's{" "}
          <code>overflow</code>/<code>z-index</code>. It cleans up automatically when
          unmounted. For modals, the native top layer below is usually simpler.
        </p>
      </header>

      <section class="space-y-3">
        <h2 class="text-sm font-bold uppercase tracking-wide text-indigo-400">Portal</h2>
        <div class="relative h-40 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <p class="text-sm text-slate-400">
            This box is <code>overflow-hidden</code>. An inline modal would be clipped
            here — the portal escapes to <code>&lt;body&gt;</code>.
          </p>
          <button
            onclick={() => (open = true)}
            class="mt-3 rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-600"
          >
            Open portal modal
          </button>

          {open && (
            <Portal to="body">
              <div
                class="fixed inset-0 z-50 grid place-items-center bg-black/60"
                onclick={() => (open = false)}
              >
                <div
                  class="rounded-xl bg-white p-6 text-slate-900 shadow-2xl"
                  onclick={(e) => e.stopPropagation()}
                >
                  <h3 class="text-lg font-bold">Portaled modal</h3>
                  <p class="mt-2 text-sm text-slate-600">
                    Rendered into <code>&lt;body&gt;</code>, escaping the clipped box.
                  </p>
                  <button
                    onclick={() => (open = false)}
                    class="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            </Portal>
          )}
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-sm font-bold uppercase tracking-wide text-emerald-400">
          Native &lt;dialog&gt; (top layer)
        </h2>
        <p class="text-sm text-slate-400">
          No relocation — <code>showModal()</code> puts it in the browser's top layer
          with a <code>::backdrop</code> and Esc-to-close for free.
        </p>
        <button
          onclick={() => dialogRef.showModal()}
          class="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-600"
        >
          Open native dialog
        </button>
        <dialog ref={dialogRef} class="rounded-xl p-6 backdrop:bg-black/50">
          <h3 class="text-lg font-bold text-slate-900">Native dialog</h3>
          <p class="mt-2 text-sm text-slate-600">Top layer, backdrop, Esc to close — built in.</p>
          <button
            onclick={() => dialogRef.close()}
            class="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Close
          </button>
        </dialog>
      </section>
    </div>
  );
}
