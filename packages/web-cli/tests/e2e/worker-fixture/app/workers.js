// Exercises the `new Worker(new URL(…, import.meta.url))` + bare `new URL(…,
// import.meta.url)` conventions the toolchain must emit/serve (workerAssetsPlugin
// in build, the /__worker & /__asset dev routes in dev). Plain `.js` so nothing
// but the worker/asset scanner touches it.

export function makeWorker() {
  return new Worker(new URL("./counter-worker.js", import.meta.url), { type: "module" });
}

// A bare asset reference (the .wasm case from the bug report).
export const pixelUrl = new URL("./pixel.wasm", import.meta.url);
