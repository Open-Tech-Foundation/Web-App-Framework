// A worker that itself spawns a worker — verifies the emit/serve pass recurses
// into nested workers (the kernel-worker → program-worker case from the report).
const inner = new Worker(new URL("./nested-worker.js", import.meta.url), { type: "module" });

let count = 0;
self.onmessage = (e) => {
  count += e.data ?? 1;
  inner.postMessage(count);
  self.postMessage(count);
};
