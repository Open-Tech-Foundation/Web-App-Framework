// Shared plumbing for the OpenTF Web toolchain (`otfw dev` / `otfw build`).
//
// Both commands treat the current working directory as the project root (its
// `index.html` + `app/`), resolve `@opentf/web` via node resolution, run the
// `otfwc` IR compiler as a Rolldown `transform` plugin, and let Rolldown link the
// module graph. This module holds everything they have in common.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSIONS = [".jsx", ".tsx", ".js", ".ts"];

export const MIME = {
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

/** Nearest ancestor directory of `from` (inclusive) that contains `name`. */
export function findUp(name, from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the project and toolchain: the app being built (cwd), the runtime
 * package, the `otfwc` compiler, and the excluded routes. Exits with a clear
 * message on any hard failure. Builds the compiler on demand from the workspace.
 */
export function loadProject() {
  const root = process.cwd();

  const appDir = join(root, "app");
  if (!existsSync(appDir)) {
    fail(
      `no app/ directory in ${root}\n  run otfw from your project root (the folder with index.html and app/).`,
    );
  }

  // Resolve the runtime the way the bundler will, so it works as an installed
  // dependency or a workspace package — no hardcoded path.
  let webEntry;
  try {
    webEntry = Bun.resolveSync("@opentf/web", root);
  } catch {
    fail(`cannot resolve "@opentf/web" from ${root}\n  add it to your dependencies.`);
  }

  // The `otfwc` compiler ships with the toolchain, not the project: find it next
  // to this CLI (the workspace debug build), overridable via OTFWC_BIN.
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const workspace = findUp("Cargo.toml", cliDir);
  const otfwc =
    process.env.OTFWC_BIN ??
    (workspace ? join(workspace, "target", "debug", "otfwc") : null);
  if (!otfwc) fail("cannot locate the otfwc compiler; set OTFWC_BIN to its path.");
  ensureCompiler(otfwc, workspace);

  // forms-demo depends on @opentf/web-form, which is not yet ported to the new
  // runtime (it lands with the Project Graph). Override with EXCLUDE_ROUTES.
  const exclude = new Set(
    (process.env.EXCLUDE_ROUTES ?? "forms-demo").split(",").filter(Boolean),
  );

  return { root, appDir, webEntry, otfwc, workspace, exclude };
}

function ensureCompiler(otfwc, workspace) {
  if (existsSync(otfwc)) return;
  if (!workspace) fail(`otfwc compiler not found at ${otfwc}`);
  console.log("building compiler (cargo build -p otfw_cli)…");
  const b = Bun.spawnSync(["cargo", "build", "-p", "otfw_cli"], {
    cwd: workspace,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (b.exitCode !== 0) process.exit(b.exitCode);
}

/** Discover file-based routes under `app/`: every page/layout and the 404. */
export function discoverPages(dir, exclude) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && exclude.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...discoverPages(full, exclude));
    else if (/^(page|layout|404)\.[jt]sx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The optional `app/routeGuard.{js,ts}` path, or null. */
export function findGuard(appDir) {
  return [join(appDir, "routeGuard.js"), join(appDir, "routeGuard.ts")].find(
    existsSync,
  );
}

/**
 * The app entry source: hand `mountApp` a route map of lazy `() => import()`
 * loaders (so each route code-splits into its own chunk) plus the optional guard.
 */
export function entrySource(pages, appDir) {
  const map = pages
    .map((p) => `    [${JSON.stringify(p)}]: () => import(${JSON.stringify(p)}),`)
    .join("\n");
  const guard = findGuard(appDir);
  return (
    `import { mountApp } from "@opentf/web";\n` +
    (guard ? `import guard from ${JSON.stringify(guard)};\n` : "") +
    `mountApp({\n  pages: {\n${map}\n  },\n` +
    `  target: document.getElementById("app"),${guard ? "\n  guard," : ""}\n});\n`
  );
}

/**
 * Rolldown plugin: compile `.jsx`/`.tsx` through the `otfwc` IR compiler. Page /
 * layout / 404 modules become factories; everything else a Custom Element. On a
 * compile error it emits a diagnostic stub (so one bad route doesn't sink the
 * build) unless `failOnError` is set (production builds should fail loudly).
 * `onResult(id, errorMessageOrNull)` is called per module so the dev server can
 * push compile diagnostics to the error overlay and clear them once fixed.
 */
export function otfwPlugin(otfwc, { failOnError = false, onResult } = {}) {
  return {
    name: "otfw",
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id)) return null;
      const base = id.split("/").pop().replace(/\.[jt]sx$/, "");
      const isPage = base === "page" || base === "layout" || base === "404";
      const args = ["build"];
      if (!isPage) args.push("--component");
      args.push("--stdin", id);
      const proc = Bun.spawnSync([otfwc, ...args], {
        stdin: new TextEncoder().encode(code),
      });
      if (proc.exitCode !== 0) {
        const msg = proc.stderr.toString();
        onResult?.(id, msg);
        if (failOnError) {
          this.error(`otfwc failed for ${id}:\n${msg}`);
        }
        console.error(`✗ otfwc failed for ${id}:\n${msg}`);
        const stub =
          `export default function () { const pre = document.createElement("pre");` +
          ` pre.style.cssText = "color:#f87171;padding:1rem;white-space:pre-wrap";` +
          ` pre.textContent = ${JSON.stringify(`Compile error in ${id}\n\n${msg}`)};` +
          ` return pre; }`;
        return { code: stub, moduleSideEffects: true };
      }
      onResult?.(id, null);
      // Side effects (e.g. customElements.define) must survive bundling.
      return { code: proc.stdout.toString(), moduleSideEffects: true };
    },
  };
}

/**
 * CSS plugin: `import "./x.css"` injects a <style>; `*.module.css` resolves to an
 * identity class-name map (`styles.foo` → "foo"). Dev-grade CSS Modules.
 */
export function cssPlugin() {
  return {
    name: "css",
    transform(code, id) {
      if (!id.endsWith(".css")) return null;
      const inject =
        `const __s = document.createElement("style");` +
        ` __s.textContent = ${JSON.stringify(code)};` +
        ` document.head.appendChild(__s);`;
      const out = id.endsWith(".module.css")
        ? `${inject}\nexport default new Proxy({}, { get: (_, k) => k });`
        : `${inject}\nexport default ${JSON.stringify(code)};`;
      return { code: out, moduleSideEffects: true };
    },
  };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
