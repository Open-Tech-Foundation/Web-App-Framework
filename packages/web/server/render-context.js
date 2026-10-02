import { setRenderContextReader } from "../core/render-context.js";

let contextPromise;

// Resolve at runtime: server consumers can run on esdev or on a runtime with
// AsyncLocalStorage. Neither runtime-specific module belongs in a browser bundle.
const loadModule = (specifier) => import(specifier);

async function createRenderContext() {
  let context;
  try {
    const { createContext } = await loadModule("runtime:context");
    context = createContext({ name: "otfw-render" });
  } catch (nativeError) {
    try {
      const { AsyncLocalStorage } = await loadModule("node:async_hooks");
      const storage = new AsyncLocalStorage();
      context = { get: () => storage.getStore(), run: (value, fn) => storage.run(value, fn) };
    } catch {
      throw new Error("SSR requires runtime:context or AsyncLocalStorage for request isolation.", { cause: nativeError });
    }
  }
  setRenderContextReader(() => context.get());
  return context;
}

export async function withRenderContext(value, fn) {
  const context = await (contextPromise ??= createRenderContext());
  return context.run(value, fn);
}
