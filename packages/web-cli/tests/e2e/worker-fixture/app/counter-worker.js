// A worker that itself spawns a worker — verifies the emit/serve pass recurses
// into nested workers (the kernel-worker → program-worker case from the report).
const inner = new Worker(new URL("./nested-worker.js", import.meta.url), { type: "module" });

// …and references a .wasm asset from *inside* the worker — the emitted worker chunk
// must be re-scanned so this asset is emitted/served too (the kernel-worker →
// workeros_web_wasm_bg.wasm case from the report).
const wasmUrl = new URL("./kernel.wasm", import.meta.url);
void wasmUrl;

let count = 0;
self.onmessage = (e) => {
  count += e.data ?? 1;
  inner.postMessage(count);
  self.postMessage(count);
};
