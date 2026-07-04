// `resource()` — the client-side async-data primitive (SPEC §7.4, docs/DATA.md).
// Components are strictly synchronous (SPEC §5.5), so async data lives *next to*
// the view: a resource wraps a fetcher in signals and the view renders its
// reactive `loading` / `error` / `data` states:
//
//   const users = resource(() => fetch("/api/users").then((r) => r.json()));
//   // in JSX: {users.loading ? <Spinner /> : users.data.map(...)}
//
// With a reactive source, the fetch re-runs whenever the source changes, and a
// `null`/`false` source pauses it (conditional fetching):
//
//   const user = resource(() => router.params.id, (id, { signal }) =>
//     fetch(`/api/users/${id}`, { signal }).then((r) => r.json()));
//
// Staleness: each run bumps a token and aborts the previous run's AbortController
// (passed to the fetcher as `{ signal }`), so an out-of-order resolution can never
// overwrite newer data — even for fetchers that ignore the signal.
//
// Server (SSG/SSR): no effect is created and nothing is fetched — `loading` stays
// `true`, so the prerendered HTML shows the loading branch. That is exactly what
// the client's first paint renders before its own fetch resolves, keeping
// hydration adoption aligned.

import { batch, effect, signal, untracked } from "../core/signals.js";

// Test override: bun tests run under happy-dom (a `document` always exists), so
// server behavior is opted into explicitly.
let serverOverride = null;

/** Force server (true) / client (false) behavior for new resources — tests only. */
export function __setResourceServer(v) {
  serverOverride = v;
}

const isServer = () => serverOverride ?? typeof document === "undefined";

/**
 * Create a resource. Two call shapes:
 *
 *   resource(fetcher, options?)          — fetch once (and on refetch())
 *   resource(source, fetcher, options?)  — re-fetch when the reactive `source`
 *                                          changes; `null`/`false` pauses
 *
 * @param {Function} source  reactive source read inside the tracking effect; its
 *        value is passed to the fetcher.
 * @param {Function} fetcher  `(sourceValue, { signal }) => data | Promise<data>`.
 * @param {{ initial?: unknown }} [options]  `initial` seeds `data` before the
 *        first resolution.
 * @returns {{ data: unknown, loading: boolean, error: unknown,
 *             refetch: () => Promise<unknown> | undefined }}  reactive getters —
 *        read them inside bindings/effects to subscribe.
 */
export function resource(source, fetcher, options = {}) {
  if (typeof fetcher !== "function") {
    options = fetcher ?? {};
    fetcher = source;
    source = null;
  }
  const src = typeof source === "function" ? source : () => true;
  const data = signal(options.initial);
  const error = signal(undefined);
  const loading = signal(true); // a fetch is intended; the server leaves it true
  let token = 0;
  let controller = null;

  function run(value) {
    controller?.abort();
    // Captured per-run: by the time a superseded run's promise settles, the
    // module-level `controller` already belongs to a newer run.
    const c = (controller = typeof AbortController !== "undefined" ? new AbortController() : null);
    const t = ++token;
    batch(() => {
      loading.value = true;
      error.value = undefined;
    });
    // The async IIFE starts the fetcher *synchronously* (no wasted microtask)
    // while converting a synchronous throw into a rejection.
    return (async () => fetcher(value, { signal: c?.signal }))()
      .then(
        (v) => {
          if (t !== token) return; // superseded — a newer run owns the signals
          batch(() => {
            data.value = v;
            loading.value = false;
          });
          return v;
        },
        (e) => {
          if (t !== token) return;
          // Keep the last good `data` (stale-while-error); only `error` flips.
          batch(() => {
            error.value = e;
            loading.value = false;
          });
        },
      );
  }

  if (!isServer()) {
    effect(() => {
      const value = src(); // the effect's ONLY tracked read
      if (value == null || value === false) {
        // Paused: cancel anything in flight and settle as "not loading".
        untracked(() => {
          token++;
          controller?.abort();
          controller = null;
          loading.value = false;
        });
        return;
      }
      untracked(() => run(value));
      // Before a re-run (source changed) and on scope dispose: invalidate + abort,
      // so a torn-down region's fetch can neither land nor leak a connection.
      return () => {
        token++;
        controller?.abort();
      };
    });
  }

  return {
    get data() {
      return data.value;
    },
    get loading() {
      return loading.value;
    },
    get error() {
      return error.value;
    },
    /** Re-run the fetcher with the current source value (no-op while paused). */
    refetch() {
      const value = untracked(src);
      if (value == null || value === false) return undefined;
      return run(value);
    },
  };
}
