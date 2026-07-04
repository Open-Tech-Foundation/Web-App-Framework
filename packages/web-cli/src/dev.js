// `otfw dev` — the CSR dev server (on-demand / lazy-route).
//
// Unlike a single eager bundle, this serves modules as the browser asks for them:
//
//   • /@fw.js          — the runtime (`@opentf/web`), bundled once and shared by
//                        every chunk through an import map (so the router and signal
//                        registry are one instance).
//   • /bundle.js       — the app entry: `mountApp` + a route table whose loaders are
//                        `() => import("/__route/<id>.js")`. The route modules are
//                        *not* in this bundle.
//   • /__route/<id>.js — one route (page or layout) compiled on first navigation,
//                        with `@opentf/web` external, then cached in memory.
//
// So startup compiles the entry + runtime only; each route's cost is paid the first
// time it's visited. The module graph (`otfwc graph`) drives HMR: on a file change
// it tells us exactly which cached chunks to drop before a reload. Tailwind/CSS and
// `public/` assets are served as before. Project root = cwd, like `vite`/`next dev`.

import { rolldown } from "rolldown";
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compileCss, usesTailwind } from "./tailwind.js";
import { overlayClient } from "./overlay.js";
import {
  EXTENSIONS,
  MIME,
  buildApiBundle,
  cssPlugin,
  discoverPages,
  entrySource,
  injectBeforeBody,
  loadConfig,
  loadDocsPlugins,
  loadProject,
  moduleGraph,
  otfwPlugin,
  readHtmlShell,
} from "./shared.js";

// Resolve the start port. An explicit `--port <n>` / `-p <n>` / `--port=<n>` is
// honored exactly (fail fast if it's busy); with no flag we default to 3000 and
// scan upward for a free port.
function resolvePort() {
  const argv = process.argv.slice(3); // args after `dev`
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--port" || a === "-p") && argv[i + 1]) {
      return { port: Number(argv[i + 1]), explicit: true };
    }
    if (a.startsWith("--port=")) {
      return { port: Number(a.slice("--port=".length)), explicit: true };
    }
  }
  return { port: 3000, explicit: false };
}

// Start `Bun.serve`. An explicit port is tried once (busy → fail fast); otherwise
// scan upward from `start` for the first free port (EADDRINUSE → next).
function serve(start, explicit, options) {
  const end = explicit ? start : start + 99;
  for (let port = start; port <= end; port++) {
    try {
      return Bun.serve({ ...options, port });
    } catch (e) {
      if (e?.code === "EADDRINUSE") {
        if (explicit) {
          console.error(`✗ port ${port} is already in use (pass a different --port)`);
          process.exit(1);
        }
        continue;
      }
      throw e;
    }
  }
  console.error(`✗ no free port found in ${start}–${end}`);
  process.exit(1);
}

// A route file ↔ its `/__route/<id>.js` URL. The id is the file path, base64url so
// it survives a URL path segment; decoding recovers the absolute path to compile.
const ROUTE_PREFIX = "/__route/";
const toRouteUrl = (file) => `${ROUTE_PREFIX}${Buffer.from(file).toString("base64url")}.js`;
const fromRouteUrl = (pathname) =>
  Buffer.from(pathname.slice(ROUTE_PREFIX.length, -".js".length), "base64url").toString("utf8");

export async function runDev() {
  const bootStart = Date.now();
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const { port: startPort, explicit: explicitPort } = resolvePort();
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    console.error(`✗ invalid --port value: ${startPort}`);
    process.exit(1);
  }

  const pages = discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    process.exit(1);
  }

  const config = await loadConfig(root);
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);

  const devDir = join(root, ".dev");
  mkdirSync(devDir, { recursive: true });
  const entryFile = join(devDir, "entry.js");
  writeFileSync(entryFile, entrySource(pages, appDir, toRouteUrl, config?.i18n, config?.nav));

  let server;
  const publish = (msg) => server?.publish("hmr", JSON.stringify(msg));
  const compileErrors = new Map();

  // One persistent compiler (one `otfwc serve` child) shared by every build below.
  const otfw = otfwPlugin(otfwc, {
    onResult: (id, err) => (err ? compileErrors.set(id, err) : compileErrors.delete(id)),
  });
  const css = cssPlugin();
  const plugins = [...docsPlugins, otfw, css];

  // Bundle `input` to a single ESM string in memory (no disk). `external` ids are
  // left as bare imports (resolved by the browser via the import map / route URLs).
  // `alias` lets the runtime build resolve its own `@opentf/web` self-imports.
  async function bundle({ input, external, alias }) {
    const b = await rolldown({
      input,
      resolve: { alias: alias || {}, extensions: EXTENSIONS },
      external,
      plugins,
    });
    try {
      const { output } = await b.generate({ format: "esm", codeSplitting: false });
      return output[0].code;
    } finally {
      await b.close();
    }
  }

  // The shared runtime, bundled once. Its components compile to `import … from
  // "@opentf/web"`; aliasing that back to the entry keeps them inside this bundle.
  async function buildFramework() {
    return bundle({ input: webEntry, alias: { "@opentf/web": webEntry } });
  }
  // The app entry: route loaders point at `/__route/…` (external — fetched lazily)
  // and `@opentf/web` is external (→ import map → /@fw.js).
  async function buildEntry() {
    return bundle({
      input: entryFile,
      external: (id) => id === "@opentf/web" || id.startsWith(ROUTE_PREFIX),
    });
  }
  // One route module (page or layout) + its components/web-docs, runtime external.
  async function buildRoute(file) {
    return bundle({ input: file, external: ["@opentf/web"] });
  }

  // Everything is built on first request and cached (Vite-style), so startup does no
  // compilation at all. `null` means "needs (re)building".
  let fwCode = null;
  let entryCode = null;
  const routeCache = new Map(); // route file → compiled chunk

  // A build error becomes a thrown-on-load stub so the overlay shows it in place.
  const errorStub = (id, msg) =>
    `throw new Error(${JSON.stringify(`Compile error in ${id}\n\n${msg}`)});`;

  // Compile `file` (framework / entry / route) on demand, surfacing a compile error
  // as a thrown-on-load stub. `build` is the matching builder.
  async function compileOnce(file, build) {
    try {
      const code = await build(file);
      compileErrors.delete(file);
      return code;
    } catch (e) {
      const msg = e?.message ?? String(e);
      compileErrors.set(file, msg);
      publish({ type: "error", kind: "compile", id: file, message: msg });
      return errorStub(file, msg);
    }
  }
  const serveFramework = async () => (fwCode ??= await compileOnce(webEntry, buildFramework));
  const serveEntry = async () => (entryCode ??= await compileOnce(entryFile, buildEntry));
  async function serveRoute(file) {
    if (!routeCache.has(file)) routeCache.set(file, await compileOnce(file, buildRoute));
    return routeCache.get(file);
  }

  // API routes (SPEC §11) are plain server modules under app/api/. In dev they're
  // built lazily on the first /api/* request and rebuilt after an edit (the watcher
  // clears the cache). `bust` busts the ESM import cache so edits take effect.
  let apiBundle = null;
  let apiBuilt = false;
  let apiVersion = 0;
  async function getApi() {
    if (!apiBuilt) {
      try {
        apiBundle = await buildApiBundle({ root, appDir, webEntry, exclude, bust: ++apiVersion });
      } catch (e) {
        console.error(`✗ API build failed: ${e?.message ?? e}`);
        apiBundle = null;
      }
      apiBuilt = true;
    }
    return apiBundle;
  }
  function invalidateApi() {
    try {
      apiBundle?.cleanup();
    } catch {}
    apiBundle = null;
    apiBuilt = false;
  }

  // The module graph powers precise invalidation; build it in the background so it
  // never blocks startup. Until it's ready, a change clears every cache (safe).
  let graph = { has: () => false, affected: () => new Set() };
  const refreshGraph = () =>
    moduleGraph(otfwc, webEntry, [...pages, webEntry]).then((g) => (graph = g));
  refreshGraph();

  // On a change, drop only the cached chunks the edited file reaches (its graph
  // dependents); a reload then rebuilds them on demand. An unknown file (e.g. a
  // workspace package we treat as external) clears everything to be safe.
  function onChange(file) {
    refreshGraph();
    const hit = graph.has(file) ? graph.affected(file) : null;
    if (!hit) {
      fwCode = entryCode = null;
      routeCache.clear();
    } else {
      if (hit.has(webEntry)) fwCode = null;
      if (file === entryFile || pages.includes(file)) entryCode = null;
      for (const f of [...routeCache.keys()]) if (hit.has(f)) routeCache.delete(f);
    }
    if (compileErrors.size > 0) {
      const [id, message] = [...compileErrors][0];
      publish({ type: "error", kind: "compile", id, message });
    } else {
      publish({ type: "reload" });
    }
  }

  // Watch app sources; a new page/layout file regenerates the route table.
  const watcher = watch(appDir, { recursive: true }, (_evt, name) => {
    if (!name) return;
    const file = join(appDir, name);
    // An API route/middleware edit (app/api/**/*.{js,ts,jsx,tsx}) rebuilds the API
    // bundle on the next request and triggers a reload.
    if (name.startsWith("api/") && /\.(jsx?|tsx?)$/.test(name)) {
      invalidateApi();
      publish({ type: "reload" });
      return;
    }
    if (/\.(mdx|md|[jt]sx|css)$/.test(name)) {
      if (/^(page|layout|404)\.(mdx|md|[jt]sx)$/.test(name.split("/").pop()) && !pages.includes(file)) {
        const fresh = discoverPages(appDir, exclude);
        pages.length = 0;
        pages.push(...fresh);
        writeFileSync(entryFile, entrySource(pages, appDir, toRouteUrl, config?.i18n, config?.nav));
      }
      onChange(file);
    }
  });
  // Ctrl+C is the normal way to stop a dev server, so treat it as a clean shutdown
  // (exit 0) rather than the conventional 130 — otherwise `bun run dev` reports it as
  // a failure. The compiler child is torn down by its own `exit` hook.
  const shutdown = () => {
    try {
      watcher.close();
    } catch {}
    invalidateApi();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => {
    try {
      watcher.close();
    } catch {}
    invalidateApi();
  });

  // Import map (so `@opentf/web` resolves to the shared runtime chunk) + entry + the
  // dev overlay / reload client. The import map must precede the module script.
  const injected =
    `<script type="importmap">{"imports":{"@opentf/web":"/@fw.js"}}</script>\n` +
    `<script type="module" src="/bundle.js"></script>\n` +
    `<script>${overlayClient}</script>\n`;

  const buildHtml = () => injectBeforeBody(readHtmlShell(root), injected);

  async function serveStatic(pathname) {
    // Only serve regular files — a request whose path is a directory (e.g. a route
    // like `/blog` that also exists as `public/blog/`) must fall through to the SPA
    // shell, not try to read the directory.
    const isFile = (f) => existsSync(f) && statSync(f).isFile();
    let file = join(root, pathname);
    if (!file.startsWith(root)) return null;
    if (!isFile(file)) {
      const fromPublic = join(root, "public", pathname);
      if (!fromPublic.startsWith(join(root, "public") + "/") || !isFile(fromPublic)) return null;
      file = fromPublic;
    }
    const ext = pathname.split(".").pop();
    if (ext === "css") {
      const source = readFileSync(file, "utf8");
      const out = usesTailwind(source)
        ? await compileCss(file, source, root).catch((err) => {
            console.error(`✗ tailwind failed for ${pathname}:\n${err?.message ?? err}`);
            return source;
          })
        : source;
      return new Response(out, { headers: { "content-type": "text/css" } });
    }
    return new Response(readFileSync(file), {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  }

  const js = (code) => new Response(code, { headers: { "content-type": "text/javascript" } });

  server = serve(startPort, explicitPort, {
    websocket: {
      open: (ws) => {
        ws.subscribe("hmr");
        if (compileErrors.size > 0) {
          const [id, message] = [...compileErrors][0];
          ws.send(JSON.stringify({ type: "error", kind: "compile", id, message }));
        }
      },
    },
    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      if (pathname === "/__hmr") {
        return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      if (pathname === "/@fw.js") return js(await serveFramework());
      if (pathname === "/bundle.js") return js(await serveEntry());
      if (pathname.startsWith(ROUTE_PREFIX) && pathname.endsWith(".js")) {
        return js(await serveRoute(fromRouteUrl(pathname)));
      }
      // API routes take precedence over the SPA shell; a non-match under /api/ is a
      // 404 (never the shell). See SPEC §11.
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        const api = await getApi();
        const res = api ? await api.handler(req) : null;
        return res ?? new Response("not found", { status: 404 });
      }
      if (pathname !== "/") {
        const asset = await serveStatic(pathname);
        if (asset) return asset;
        if (/\.[a-z0-9]+$/i.test(pathname)) return new Response("not found", { status: 404 });
      }
      return new Response(buildHtml(), { headers: { "content-type": "text/html" } });
    },
  });

  console.log(`\n  OTF Web dev server`);
  console.log(`  → http://localhost:${server.port}  (${pages.length} routes, on-demand)`);
  console.log(`  ✓ ready in ${Date.now() - bootStart}ms — routes compile on first visit\n`);
}
