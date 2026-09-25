// File-convention routing for pure-esdev apps: a virtual `@otfw/routes`
// module built by crawling `app/` — the same map the file discovery would
// hand `mountApp`, without a CLI in the loop:
//
//   // entry.js — the whole app shell, Vite-style:
//   import { mountApp } from "@opentf/web";
//   import { guard, pages } from "@otfw/routes";
//
//   mountApp({ pages, guard, target: document.getElementById("app") });
//
// ```json
// { "plugins": [{ "module": "@opentf/esdev-plugin-web",
//                 "export": "createOtfwRoutes",
//                 "options": { "appDir": "app" } }] }
// ```
//
// Route keys keep their `/app/...` shape because the runtime's `routeFromPath`
// anchors on it; layouts compose by path (`layout.jsx` wraps its directory).
// Page / layout / 404 modules compile through the `otfw` transform plugin —
// list both. Only `resolve` + `load` here, so this half runs under
// `esdev start` / `esdev build`, not under `esdev test` (which runs
// `transform` only); tests hand-write the map instead.

import { Glob, stat } from "runtime:fs";
import { cwd } from "runtime:process";
import { join, resolve } from "runtime:path";

async function isFile(path) {
  try {
    return (await stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Route files under `dir`: page / layout / 404 modules. No `exclude` option
 * exists on the scan, so subtrees are filtered here (per docs). Yields are
 * relative to `dir`, always `/`-separated, top-level files included.
 */
async function discoverPages(dir, exclude = new Set()) {
  const out = [];
  const scan = new Glob("**/{page,layout,404}.{mdx,md,jsx,tsx}").scan(dir);
  for await (const rel of scan) {
    if ([...exclude].some((name) => rel === name || rel.startsWith(`${name}/`))) continue;
    out.push(join(dir, rel));
  }
  return out;
}

function stripAppPrefix(filePath, appDir) {
  if (appDir) {
    const base = appDir.replace(/\/+$/, "");
    if (filePath.startsWith(base + "/")) return filePath.slice(base.length);
  }
  return filePath.replace(/^.*\/app(?=\/)/, "");
}

/** The map key for a route file — keeps `/app` so `routeFromPath` resolves it. */
function routeKey(filePath, appDir) {
  return `/app${stripAppPrefix(filePath, appDir)}`;
}

/** The optional `app/routeGuard.{js,ts}` path, or null. */
async function findGuard(appDir) {
  for (const f of [join(appDir, "routeGuard.js"), join(appDir, "routeGuard.ts")]) {
    if (await isFile(f)) return f;
  }
  return null;
}

export function createOtfwRoutes({ appDir = "app", exclude = [] } = {}) {
  const excluded = new Set(exclude);
  return {
    name: "otfw-routes",
    resolve: {
      filter: { id: "@otfw/routes" },
      handler: () => ({ id: "@otfw/routes", virtual: true }),
    },
    load: {
      filter: { id: "@otfw/routes" },
      async handler() {
        const root = resolve(cwd(), appDir);
        const pages = await discoverPages(root, excluded);
        const map = pages
          .map((p) => `  [${JSON.stringify(routeKey(p, root))}]: () => import(${JSON.stringify(p)}),`)
          .join("\n");
        const guard = await findGuard(root);
        const code =
          `export const pages = {\n${map}\n};\n` +
          (guard
            ? `export { default as guard } from ${JSON.stringify(guard)};\n`
            : `export const guard = undefined;\n`);
        // The discovered files, so an edit rebuilds the map. (Directories are
        // not listed: `dependsOn` names files the graph cannot discover.)
        return { code, type: "js", dependsOn: pages };
      },
    },
  };
}
