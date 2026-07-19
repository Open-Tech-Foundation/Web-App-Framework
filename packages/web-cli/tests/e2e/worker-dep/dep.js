// A dependency that spawns its OWN worker via `new Worker(new URL(…, import.meta.url))`.
// The test symlinks this package into the fixture's node_modules, so its real path
// resolves OUTSIDE the project root — exactly how a workspace/isolated dependency
// (e.g. `@opentf/workeros-web`) lands. The dev server must still serve `dep-worker.js`
// (it used to 404 because a root-containment guard rejected the symlinked real path).
export function makeDepWorker() {
  return new Worker(new URL("./dep-worker.js", import.meta.url), { type: "module" });
}
