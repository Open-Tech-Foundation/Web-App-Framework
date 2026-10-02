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
// `appDir` is a leaf resolved against the importing entry's site root (see
// `createOtfwRoutes`), so every app in a multi-app repo shares the one value.
//
// Route keys keep their `/app/...` shape because the runtime's `routeFromPath`
// anchors on it; layouts compose by path (`layout.jsx` wraps its directory).
// Page / layout / 404 modules compile through the `otfw` transform plugin —
// list both. The `resolve` + `load` hooks run during builds and, in esdev
// 0.14+, unbundled tests/scripts too. Tests that hand-write their map can
// omit this plugin from their config.

import { Glob, stat } from "runtime:fs";
import { cwd } from "runtime:process";
import { dirname, join, resolve } from "runtime:path";

async function isFile(path) {
  try {
    return (await stat(path)).isFile;
  } catch {
    return false;
  }
}

async function isDir(path) {
  try {
    return (await stat(path)).isDir;
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
    if (/(^|\/)404\.(mdx|md)$/.test(rel)) {
      throw new Error(`Unsupported Markdown 404 route: ${join(dir, rel)}. Use 404.jsx or 404.tsx instead.`);
    }
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
  // A leaf `appDir` ("app") anchors at the importing entry's site root — the
  // entry lives beside `app/` in every app, so one option value serves the
  // website, the playground, and standalone checkouts alike, whatever config
  // (`--config`) or cwd the build runs under. A nested path ("website/app")
  // keeps the legacy meaning: resolved against the process cwd.
  const nested = appDir.includes("/");
  async function resolveRoot(importer) {
    if (nested || !importer) return resolve(cwd(), appDir);
    let dir = dirname(importer);
    for (;;) {
      if (await isDir(join(dir, appDir))) return join(dir, appDir);
      const up = dirname(dir);
      if (up === dir) return resolve(cwd(), appDir);
      dir = up;
    }
  }
  return {
    name: "otfw-routes",
    // The importer is only visible to `resolve` (as a positional), never to
    // `load` — so `resolve` answers a per-site virtual id (`@otfw/routes:<appRoot>`)
    // and `load` parses its site back out. Stateless across concurrent builds.
    resolve: {
      filter: { id: "@otfw/routes" },
      async handler(source, importer) {
        const appRoot = await resolveRoot(importer);
        return { id: `@otfw/routes:${appRoot}`, virtual: true };
      },
    },
    load: {
      filter: { id: /^@otfw\/routes:/ },
      async handler(id) {
        const root = id.slice("@otfw/routes:".length);
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
