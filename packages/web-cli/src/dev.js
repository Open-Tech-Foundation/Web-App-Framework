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
import { dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { compileCss, usesTailwind } from "./tailwind.js";
import { overlayClient } from "./overlay.js";
import {
  EXTENSIONS,
  MIME,
  assertNoRouteConflicts,
  buildApiBundle,
  buildLoaderBundle,
  cssPlugin,
  discoverApiRoutes,
  discoverLoaders,
  discoverPages,
  entrySource,
  loaderRoutePath,
  injectBeforeBody,
  loadConfig,
  loadDocsPlugins,
  loadProject,
  matchProxyTarget,
  moduleGraph,
  otfwPlugin,
  proxyRequest,
  readHtmlShell,
  resolveProxyRules,
  applyNewUrlEdits,
  resolveNewUrlRef,
  scanNewUrlRefs,
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

// Worker scripts (`new Worker(new URL("./w.js", import.meta.url))`) and binary
// assets (`new URL("./x.wasm", import.meta.url)`) get their own dev URLs, same
// base64url-of-absolute-path scheme as routes. Assets keep their real extension so
// the browser gets the right MIME; the base64url body never contains a `.`, so the
// first dot cleanly separates path from extension when decoding.
const WORKER_PREFIX = "/__worker/";
const ASSET_PREFIX = "/__asset/";
const toWorkerUrl = (file) => `${WORKER_PREFIX}${Buffer.from(file).toString("base64url")}.js`;
const fromWorkerUrl = (pathname) =>
  Buffer.from(pathname.slice(WORKER_PREFIX.length, -".js".length), "base64url").toString("utf8");
const toAssetUrl = (file) => `${ASSET_PREFIX}${Buffer.from(file).toString("base64url")}${extname(file)}`;
const fromAssetUrl = (pathname) =>
  Buffer.from(pathname.slice(ASSET_PREFIX.length).split(".")[0], "base64url").toString("utf8");

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
  assertNoRouteConflicts(appDir, exclude);

  const config = await loadConfig(root);
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);
  // Dev proxy (SPEC §11 / deployment): forward configured path prefixes to a
  // separately-running backend instead of handling them in-process. This is how a
  // provider-agnostic app reaches bindings the dev server can't host itself — e.g.
  // `proxy: { "/api": "http://localhost:8787" }` to a local `wrangler dev` for D1.
  const proxyRules = resolveProxyRules(config);

  const devDir = join(root, ".dev");
  mkdirSync(devDir, { recursive: true });
  const entryFile = join(devDir, "entry.js");
  const loaderRoutes = () => discoverLoaders(appDir, exclude).map((f) => loaderRoutePath(f, appDir));
  const writeEntry = () =>
    writeFileSync(entryFile, entrySource(pages, appDir, toRouteUrl, config?.i18n, config?.nav, loaderRoutes()));
  writeEntry();

  let server;
  const publish = (msg) => server?.publish("hmr", JSON.stringify(msg));
  const compileErrors = new Map();

  // One persistent compiler (one `otfwc serve` child) shared by every build below.
  const otfw = otfwPlugin(otfwc, {
    onResult: (id, err) => (err ? compileErrors.set(id, err) : compileErrors.delete(id)),
  });
  const css = cssPlugin();
  // Rewrite `new Worker(new URL("./w.js", …))` → a `/__worker/…` dev URL (bundled
  // self-contained on request) and bare `new URL("./x.wasm", …)` → a `/__asset/…`
  // dev URL (served from disk). Included in every bundle below so entry, routes,
  // and worker scripts (nested workers) all get rewritten. Without this the browser
  // resolves the raw literal against the served module's URL → 404.
  const devWorkerAssets = {
    name: "otfw:dev-worker-assets",
    async transform(code, id) {
      const found = scanNewUrlRefs(code);
      if (found.length === 0) return null;
      const edits = [];
      for (const ref of found) {
        const abs = await resolveNewUrlRef(this, ref.spec, id);
        if (!abs) {
          this.warn(
            `could not resolve new URL(${JSON.stringify(ref.spec)}, import.meta.url) ` +
              `in ${id} — left as-is; it will 404 at runtime`,
          );
          continue;
        }
        const url = ref.isWorker ? toWorkerUrl(abs) : toAssetUrl(abs);
        edits.push({ start: ref.start, end: ref.end, text: `new URL(${JSON.stringify(url)}, import.meta.url)` });
      }
      if (edits.length === 0) return null;
      return { code: applyNewUrlEdits(code, edits), moduleSideEffects: true };
    },
  };
  const plugins = [...docsPlugins, otfw, css, devWorkerAssets];

  // Bundle `input` to a single ESM string in memory (no disk). `external` ids are
  // left as bare imports (resolved by the browser via the import map / route URLs).
  // `alias` lets the runtime build resolve its own `@opentf/web` self-imports.
  async function bundle({ input, external, alias }) {
    const b = await rolldown({
      input,
      resolve: { alias: alias || {}, extensions: EXTENSIONS },
      external,
      // Enables the runtime's dev-only diagnostics (SPEC §5.4.4); `otfw build`
      // defines this as "production" so they compile away.
      transform: { define: { "process.env.NODE_ENV": '"development"' } },
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
  // A worker script, bundled self-contained: a worker has no access to the page's
  // import map, so `@opentf/web` must be inlined (aliased) rather than left external.
  async function buildWorker(file) {
    return bundle({ input: file, alias: { "@opentf/web": webEntry } });
  }

  // Everything is built on first request and cached (Vite-style), so startup does no
  // compilation at all. `null` means "needs (re)building".
  let fwCode = null;
  let entryCode = null;
  const routeCache = new Map(); // route file → compiled chunk
  const workerCache = new Map(); // worker file → compiled chunk

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
  async function serveWorker(file) {
    if (!workerCache.has(file)) workerCache.set(file, await compileOnce(file, buildWorker));
    return workerCache.get(file);
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
        apiBundle = await buildApiBundle({
          root,
          appDir,
          webEntry,
          exclude,
          i18n: config?.i18n,
          bust: ++apiVersion,
        });
      } catch (e) {
        console.error(`✗ API build failed: ${e?.message ?? e}`);
        apiBundle = await brokenApiStub(e);
      }
      apiBuilt = true;
    }
    return apiBundle;
  }
  // A failed API/middleware build must not silently serve the SPA shell for
  // endpoint URLs — or, worse, serve middleware-guarded paths unguarded: stand in
  // with a handler that 500s exactly the discovered endpoints and a middleware
  // that 500s exactly the governed scopes (real matching semantics via
  // createApiHandler / createMiddleware) until the next successful rebuild.
  async function brokenApiStub(err) {
    try {
      const serverApi = pathToFileURL(join(dirname(webEntry), "server", "index.js")).href;
      const { createApiHandler, createMiddleware } = await import(serverApi);
      // Strip ANSI color codes — the bundler's terminal diagnostic goes into JSON here.
      const msg = String(err?.message ?? err).replace(/\u001b\[[0-9;]*m/g, "");
      const fail = () => Response.json({ error: `API routes failed to build: ${msg}` }, { status: 500 });
      const stub = Object.fromEntries(
        ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => [m, fail]),
      );
      const { routes, middleware } = discoverApiRoutes(appDir, exclude);
      const handler = createApiHandler(Object.fromEntries(routes.map((f) => [f, stub])), {}, { appDir });
      return {
        handler,
        apiRoutes: handler,
        middleware: createMiddleware(Object.fromEntries(middleware.map((f) => [f, { default: fail }])), {
          appDir,
          i18n: config?.i18n,
        }),
        routes,
        middlewareFiles: middleware,
        cleanup: () => {},
      };
    } catch {
      return null;
    }
  }
  function invalidateApi() {
    try {
      apiBundle?.cleanup();
    } catch {}
    apiBundle = null;
    apiBuilt = false;
  }

  // Route loaders (docs/DATA.md) are plain server modules like API routes, and get
  // the same treatment: built lazily on the first `__data.json` request, rebuilt
  // after an edit (the watcher clears the cache), ESM cache busted per rebuild.
  let loaderBundle = null;
  let loadersBuilt = false;
  let loaderVersion = 0;
  async function getLoaders() {
    if (!loadersBuilt) {
      try {
        loaderBundle = await buildLoaderBundle({
          root,
          appDir,
          webEntry,
          exclude,
          i18n: config?.i18n,
          bust: ++loaderVersion,
        });
      } catch (e) {
        console.error(`✗ loader build failed: ${e?.message ?? e}`);
        loaderBundle = null;
      }
      loadersBuilt = true;
    }
    return loaderBundle;
  }
  function invalidateLoaders() {
    try {
      loaderBundle?.cleanup();
    } catch {}
    loaderBundle = null;
    loadersBuilt = false;
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
      workerCache.clear();
    } else {
      if (hit.has(webEntry)) fwCode = null;
      if (file === entryFile || pages.includes(file)) entryCode = null;
      for (const f of [...routeCache.keys()]) if (hit.has(f)) routeCache.delete(f);
      // The module graph doesn't trace worker scripts (they're a separate bundle),
      // so a worker edit lands here as an "unknown reach"; clear the worker cache
      // whenever anything the edit touches is a worker file or the graph is unsure.
      for (const f of [...workerCache.keys()]) if (hit.has(f) || f === file) workerCache.delete(f);
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
    // An API endpoint/middleware edit (any `route.*` / `_middleware.*` file) rebuilds
    // the API bundle on the next request and triggers a reload.
    if (/^(route|_middleware)\.(jsx?|tsx?)$/.test(name.split("/").pop())) {
      invalidateApi();
      publish({ type: "reload" });
      return;
    }
    // A loader edit rebuilds the loader bundle on the next data request; a new or
    // deleted loader.* also changes the route set baked into the entry, so the
    // entry is rewritten and its cached chunk dropped (a stale set would make SPA
    // nav skip the fetch — or fetch a 404).
    if (/^loader\.(js|ts)$/.test(name.split("/").pop())) {
      invalidateLoaders();
      writeEntry();
      entryCode = null;
      publish({ type: "reload" });
      return;
    }
    if (/\.(mdx|md|[jt]sx|css)$/.test(name)) {
      if (/^(page|layout|404)\.(mdx|md|[jt]sx)$/.test(name.split("/").pop()) && !pages.includes(file)) {
        const fresh = discoverPages(appDir, exclude);
        pages.length = 0;
        pages.push(...fresh);
        writeEntry();
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
    invalidateLoaders();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => {
    try {
      watcher.close();
    } catch {}
    invalidateApi();
    invalidateLoaders();
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
      // Worker scripts + `new URL` assets, rewritten to these dev URLs by
      // `devWorkerAssets`. Both decode a base64url absolute path; normalize and
      // guard it to the project root so a crafted `..` URL can't read arbitrary files.
      const underRoot = (file) => {
        const abs = resolve(file);
        return (abs === root || abs.startsWith(root + sep)) && existsSync(abs) ? abs : null;
      };
      if (pathname.startsWith(WORKER_PREFIX) && pathname.endsWith(".js")) {
        const file = underRoot(fromWorkerUrl(pathname));
        if (!file) return new Response("not found", { status: 404 });
        return js(await serveWorker(file));
      }
      if (pathname.startsWith(ASSET_PREFIX)) {
        const file = underRoot(fromAssetUrl(pathname));
        if (!file) return new Response("not found", { status: 404 });
        const ext = extname(file).slice(1);
        return new Response(readFileSync(file), {
          headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
        });
      }
      // Dev proxy: a configured path prefix is forwarded to its target origin
      // (e.g. a local `wrangler dev`) instead of being handled here — so bindings
      // like D1 resolve against the real runtime. Checked before the in-process API
      // so proxied endpoints never also run locally. Dev-internal routes above are
      // never proxied (they returned already).
      if (proxyRules.length) {
        const target = matchProxyTarget(pathname, proxyRules);
        if (target) return proxyRequest(req, target);
      }
      // Static assets that exist on disk are served directly, outside the
      // middleware pipeline (a root auth guard must not break the login page's
      // CSS); `__data.json` is excluded — loader data is governed by its page's
      // middleware. Only dotted paths are fast-pathed, so an extensionless page
      // route can never be shadowed and `/api/v1.0`-style endpoints (a dotted
      // segment, no file) fall through into the pipeline.
      if (/\.[a-z0-9]+$/i.test(pathname) && pathname !== "/" && !pathname.endsWith("/__data.json")) {
        const asset = await serveStatic(pathname);
        if (asset) return asset;
      }
      // The routed pipeline the middleware chain wraps (docs/MIDDLEWARE.md): API
      // dispatch → loader data endpoint → assets → the SPA shell. It routes on the
      // request the chain hands it (`next(new Request(...))` rewrites), and
      // `context.locals` (stamped by middleware) reaches API handlers and loaders.
      // `getApi()` is O(1) after the first build (or a no-op when the app has no
      // route.* / _middleware.* files).
      const api = await getApi();
      const terminal = async (req2, context) => {
        const path2 = new URL(req2.url).pathname;
        // API endpoints (route.* files, at any path — SPEC §11): a matched handler's
        // Response wins; a miss falls through to static assets / the SPA shell, so
        // pages and endpoints coexist.
        {
          const res = api ? await (api.apiRoutes ?? api.handler)(req2, undefined, undefined, { locals: context.locals }) : null;
          if (res) return res;
        }
        // The route-loader data endpoint (docs/DATA.md): `<path>/__data.json` is a
        // reserved suffix — answered here (SPA navigation fetches it) and never
        // allowed to fall through to assets or the SPA shell, so a miss is a 404.
        if (path2 === "/__data.json" || path2.endsWith("/__data.json")) {
          try {
            const bundle = await getLoaders();
            const res = bundle ? await bundle.loaders.handle(req2, { locals: context.locals }) : null;
            if (res) return res;
          } catch (e) {
            console.error(`✗ loader failed for ${path2}: ${e?.message ?? e}`);
            return Response.json({ error: "Internal Server Error" }, { status: 500 });
          }
          return Response.json(null, { status: 404 });
        }
        if (path2 !== "/") {
          const asset = await serveStatic(path2);
          if (asset) return asset;
          if (/\.[a-z0-9]+$/i.test(path2)) return new Response("not found", { status: 404 });
        }
        return new Response(buildHtml(), { headers: { "content-type": "text/html" } });
      };
      const mw = api?.middleware;
      if (mw && mw.size > 0) return mw.run(req, terminal);
      return terminal(req, { url: new URL(req.url), locals: {} });
    },
  });

  console.log(`\n  OTF Web dev server`);
  console.log(`  → http://localhost:${server.port}  (${pages.length} routes, on-demand)`);
  for (const r of proxyRules) console.log(`  ↪ proxy ${r.prefix} → ${r.target}`);
  console.log(`  ✓ ready in ${Date.now() - bootStart}ms — routes compile on first visit\n`);
}
