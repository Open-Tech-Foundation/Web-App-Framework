// Exercises the `new Worker(new URL(…, import.meta.url))` + bare `new URL(…,
// import.meta.url)` conventions the toolchain must emit/serve (workerAssetsPlugin
// in build, the /__worker & /__asset dev routes in dev). Plain `.js` so nothing
// but the worker/asset scanner touches it.

// The worker is ALSO referenced as a bare `new URL` (e.g. a prefetch link), and —
// critically for the regression — this bare reference is scanned BEFORE the
// `new Worker(...)` below. It must not downgrade the worker to a copied asset: the
// worker has to stay a bundled chunk so its nested worker + wasm still recurse
// (the dedup cross-contamination bug — asset-first ordering was the trigger).
export const workerPrefetchUrl = new URL("./counter-worker.js", import.meta.url);

export function makeWorker() {
  return new Worker(new URL("./counter-worker.js", import.meta.url), { type: "module" });
}

// A bare asset reference (the .wasm case from the bug report).
export const pixelUrl = new URL("./pixel.wasm", import.meta.url);
