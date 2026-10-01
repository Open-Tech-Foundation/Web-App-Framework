// `runtime:build` plugins for OTF Web: compile `.jsx`/`.tsx` (and `.mdx`/`.md`
// sources that lower to JSX) through the `otfwc` IR compiler.
//
// Pass the returned objects in a driver's `plugins` array:
//
//   import { build } from "runtime:build";
//   import { otfwPlugin } from "@opentf/esdev-plugin-web";
//
//   const bundle = await build({
//     input: "app/page.jsx",
//     plugins: [otfwPlugin(otfwc, { target: "csr" })],
//   });
//
// `otfwc` is the compiler binary path — see `resolveCompiler()` in
// `./compiler.js`. One persistent `otfwc serve` child serves every module of
// every build in the process (see `startCompilerServer`).

import { resolveCompiler, startCompilerServer } from "./compiler.js";

const MODES = new Set(["spa", "ssg", "ssr"]);
const TARGETS = new Set(["csr", "ssg", "hydrate"]);

// The project has one plugin list. Its rendering mode is an option; the host
// supplies the command/platform for each hook, including unbundled imports.
function renderingTarget(mode, ctx) {
  if (ctx?.platform === "server") return "ssg";
  if (ctx?.command === "test" || ctx?.command === "start") return "csr";
  return mode === "spa" ? "csr" : "hydrate";
}

/**
 * Project-plugin factory for `esdev.json`:
 *
 *   { "plugins": [{ "module": "@opentf/esdev-plugin-web",
 *                   "export": "createOtfwPlugin",
 *                   "options": { "target": "csr" } }] }
 *
 * Deliberately synchronous: it only builds the plugin object — the compiler
 * resolves lazily on the first transformed module (same one-process
 * `otfwc serve` child as `otfwPlugin`). An async factory would depend on the
 * host awaiting it; this shape works either way.
 */
export function createOtfwPlugin({ target, mode = "spa", failOnError = false, onResult, quiet } = {}) {
  if (!MODES.has(mode)) throw new Error(`Unknown OTF rendering mode: ${mode} (expected spa, ssg, or ssr)`);
  if (target !== undefined && !TARGETS.has(target)) {
    throw new Error(`Unknown OTF compiler target: ${target} (expected csr, ssg, or hydrate)`);
  }
  let serverPromise = null;
  const getServer = () =>
    (serverPromise ??= resolveCompiler().then(({ otfwc }) => startCompilerServer(otfwc, { sourceMap: true })));
  return {
    name: "otfw",
    transform: {
      // Same host-side filter as `otfwPlugin` below.
      filter: { id: /\.(mdx|md|[jt]sx)$/ },
      async handler(code, id, ctx) {
        // A preceding transform may already have lowered this JSX to JS.
        if (ctx?.type === "js" && /\.[jt]sx$/.test(id)) return null;
        const server = await getServer();
        return compileModule(server, code, id, {
          target: target ?? renderingTarget(mode, ctx),
          failOnError, onResult, quiet, ctx,
        });
      },
    },
  };
}

async function compileModule(server, code, id, { target, failOnError, onResult, quiet = () => {}, ctx }) {
  const base = id.split("/").pop().replace(/\.(mdx|md|[jt]sx)$/, "");
  const isPage = base === "page" || base === "layout" || base === "404";
  try {
    const { code: out, map } = await server.compile(id, code, !isPage, target);
    onResult?.(id, null);
    // otfwc has already lowered the JSX, so the result is plain JavaScript —
    // saying so keeps the bundler from parsing a `.jsx` id as JSX a second time.
    // Side effects (e.g. customElements.define) must survive bundling.
    return { code: out, ...(map ? { map } : {}), type: "js", moduleSideEffects: true };
  } catch (e) {
    // `text` is the diagnostic as a terminal/overlay would show it — the position
    // line plus a code frame; `diag` is the same thing as fields, for the overlay.
    const text = e?.text ?? e?.message ?? String(e);
    const diag = e?.diag ?? { file: id, message: e?.message ?? String(e) };
    onResult?.(id, diag);
    // A build phase may be spinning on the last line of the terminal; take it
    // back before writing a diagnostic across it.
    quiet();
    // When the failure stops the build, the diagnostic travels with it and the
    // CLI prints it once, unwrapped — printing here too would show it twice.
    if (failOnError) {
      if (ctx?.error) ctx.error(`otfwc failed:\n${text}`);
      throw e;
    }
    console.error(`✗ otfwc failed:\n${text}`);
    const stub =
      `export default function () { const pre = document.createElement("pre");` +
      ` pre.style.cssText = "color:#f87171;padding:1rem;white-space:pre-wrap";` +
      ` pre.textContent = ${JSON.stringify(`Compile error\n\n${text}`)};` +
      ` return pre; }`;
    return { code: stub, map: { version: 3, sources: [], names: [], mappings: "" }, type: "js", moduleSideEffects: true };
  }
}

/**
 * Bundler plugin: compile `.jsx`/`.tsx` through the `otfwc` IR compiler. Page /
 * layout / 404 modules become factories; everything else a Custom Element. On a
 * compile error it emits a diagnostic stub (so one bad route doesn't sink the
 * build) unless `failOnError` is set (production builds should fail loudly).
 * `onResult(id, diagnosticOrNull)` is called per module so the driver can push
 * compile diagnostics to an error overlay and clear them once fixed. The
 * diagnostic is the compiler's structured one
 * (`{ file, message, line, column, frame, note }`). `quiet()` takes back a
 * live progress line before the diagnostic is printed; drivers without one
 * leave the default no-op.
 *
 * Compilation runs through one persistent `otfwc serve` process per plugin instance
 * (see `startCompilerServer`). `target` picks the codegen backend: `"csr"` (the live
 * DOM build), `"ssg"` (HTML-string renderers), or `"hydrate"` (the dual module — a
 * CSR build factory plus an adopt factory for first-paint hydration).
 */
export function otfwPlugin(otfwc, { failOnError = false, onResult, target = "csr", quiet = () => {} } = {}) {
  const server = startCompilerServer(otfwc, { sourceMap: true });
  return {
    // The compiler child is not torn down from a hook — the bundler validates hook
    // names strictly, and there is nothing to tear down per build anyway: one child
    // serves every build, and it exits on the EOF its stdin gets when we do.
    name: "otfw",
    transform: {
      // Matched on the Rust side, so a module the compiler has no business seeing
      // never costs a crossing into this isolate.
      filter: { id: /\.(mdx|md|[jt]sx)$/ },
      async handler(code, id, ctx) {
        return compileModule(server, code, id, { target, failOnError, onResult, quiet, ctx });
      },
    },
  };
}
