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
// time it's visited. Each chunk records the files it was built from (the bundler's own
// dependency set, including what plugins generated their modules from), so a file
// change drops exactly the chunks that came from it before the browser reloads.
// Tailwind/CSS and `public/` assets are served as before. Project root = cwd, like
// `vite`/`next dev`.

import { rolldown } from "rolldown";
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, extname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { compileCss, usesTailwind } from "./tailwind.js";
import { overlayClient } from "./overlay.js";
import {
  EXTENSIONS,
  MIME,
  CONFIG_FILENAMES,
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
  moduleReloader,
  otfwPlugin,
  proxyRequest,
  readHtmlShell,
  resolveProxyRules,
  applyNewUrlEdits,
  resolveNewUrlRef,
  scanNewUrlRefs,
  shouldChunkNewUrl,
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

  const devDir = join(root, ".dev");
  const publicDir = join(root, "public");
  // Build plugins that read JS data files (a docs `_meta.js`) get this instead of a
  // plain `import()`, which would pin the file's first version for the whole session.
  const importFresh = moduleReloader(devDir);
  // The config is re-read on every `otfw.config.*` edit (see `reloadConfig`), so
  // everything derived from it — the docs plugins, the proxy table, the i18n/nav
  // options baked into the entry — is `let`, not `const`.
  let config = await loadConfig(root);
  let docsPlugins = await loadDocsPlugins(root, appDir, config, exclude, importFresh);
  // Dev proxy (SPEC §11 / deployment): forward configured path prefixes to a
  // separately-running backend instead of handling them in-process. This is how a
  // provider-agnostic app reaches bindings the dev server can't host itself — e.g.
  // `proxy: { "/api": "http://localhost:8787" }` to a local `wrangler dev` for D1.
  let proxyRules = resolveProxyRules(config);

  const entryFile = join(devDir, "entry.js");
  const loaderRoutes = () => discoverLoaders(appDir, exclude).map((f) => loaderRoutePath(f, appDir));
  // Re-discover the pages on disk. Returns whether the set changed — a new or
  // deleted page/layout changes the route table baked into the entry.
  function syncPages() {
    const fresh = discoverPages(appDir, exclude);
    if (fresh.length === pages.length && fresh.every((p, i) => p === pages[i])) return false;
    pages.length = 0;
    pages.push(...fresh);
    return true;
  }
  // (Re)generate the dev entry. Called before every entry build rather than only on
  // startup, so the route table is always what's on disk right now and the file is
  // recreated if `.dev/` disappeared underneath us (a `git clean`, a temp sweeper, a
  // stray `rm -rf`). Without that, one missing file used to wedge the server in a
  // permanent "Cannot resolve entry module .dev/entry.js" until it was restarted.
  function writeEntry() {
    syncPages();
    mkdirSync(devDir, { recursive: true });
    writeFileSync(entryFile, entrySource(pages, appDir, toRouteUrl, config?.i18n, config?.nav, loaderRoutes()));
  }
  writeEntry();

  let server;
  const publish = (msg) => server?.publish("hmr", JSON.stringify(msg));

  // Two error sources, kept apart so one can't erase the other: `moduleErrors` are
  // otfwc diagnostics for a single module (the bundle still succeeds — the plugin
  // substitutes a stub), `buildErrors` are bundler-level failures for a whole chunk
  // (unresolved import, missing entry). A bundle-level failure breaks everything the
  // chunk contains, so it's reported first.
  const moduleErrors = new Map();
  const buildErrors = new Map();
  const firstError = () => [...buildErrors.values(), ...moduleErrors.values()][0] ?? null;

  // Terminal diagnostics carry ANSI color; the overlay renders text, where the escape
  // codes show up as `[31m` noise around the message.
  const plain = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  // A diagnostic on the wire: where it happened (project-relative, so the overlay can
  // show `app/blog/page.jsx:12:4` rather than a machine-specific absolute path), what
  // happened, and the code frame around it when the compiler located one.
  // The bundler locates its own errors, in its own rendering (`╭─[ app/x.jsx:1:15 ]`).
  // Lifting that position into the same fields means the overlay header reads the same
  // whoever reported the problem.
  const BUNDLER_LOC = /\u256d\u2500\[\s*([^\s\]]+):(\d+):(\d+)/;
  const errorFrame = (file, { message, line, column, frame, note } = {}) => {
    const text = plain(message);
    const found = line ? null : BUNDLER_LOC.exec(text);
    return {
      type: "error",
      kind: "compile",
      id: file,
      file: found?.[1] ?? (file.startsWith(root + sep) ? file.slice(root.length + 1) : file),
      line: line ?? (found ? Number(found[2]) : null),
      column: column ?? (found ? Number(found[3]) : null),
      message: text,
      frame: frame ? plain(frame) : null,
      note: note ?? null,
    };
  };

  // One persistent compiler (one `otfwc serve` child) shared by every build below.
  const otfw = otfwPlugin(otfwc, {
    onResult: (id, diag) => {
      if (!diag) return moduleErrors.delete(id);
      const msg = errorFrame(id, diag);
      moduleErrors.set(id, msg);
      // Surface it while the browser is waiting on this very chunk — the request
      // resolves to a stub, so nothing else would tell the page what went wrong.
      publish(msg);
    },
  });
  const css = cssPlugin();
  // Rewrite `new Worker(new URL("./w.js", …))` → a `/__worker/…` dev URL (bundled
  // self-contained on request) and bare `new URL("./x.wasm", …)` → a `/__asset/…`
  // dev URL (served from disk). Included in every bundle below so entry, routes,
  // and worker scripts (nested workers) all get rewritten. Without this the browser
  // resolves the raw literal against the served module's URL → 404.
  // The set of absolute paths this plugin has actually rewritten a `new URL` ref to.
  // The fetch handlers serve only these — so a worker/asset that legitimately lives in
  // a symlinked dependency (realpath outside the project root) is served, while a
  // crafted `..`/arbitrary `/__worker/` or `/__asset/` URL that was never emitted is
  // refused. This replaces a root-containment check, which wrongly rejected any
  // dependency whose real path resolves outside `root` (e.g. an isolated node_modules).
  const devWorkerFiles = new Set();
  const devAssetFiles = new Set();
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
        // A JS-ish target is bundled + served as a worker route (its own nested refs
        // rewritten), so a worker referenced both as `new Worker` and a bare `new URL`
        // resolves to the same bundled script; binary assets serve verbatim from disk.
        let url;
        if (shouldChunkNewUrl(abs, ref.isWorker)) {
          devWorkerFiles.add(abs);
          url = toWorkerUrl(abs);
        } else {
          devAssetFiles.add(abs);
          url = toAssetUrl(abs);
        }
        edits.push({ start: ref.start, end: ref.end, text: `new URL(${JSON.stringify(url)}, import.meta.url)` });
      }
      if (edits.length === 0) return null;
      return { code: applyNewUrlEdits(code, edits), moduleSideEffects: true };
    },
  };
  // Rebuilt whenever the config changes (the docs/blog plugins come from it); every
  // build below reads this binding at call time, so a reload is picked up at once.
  let plugins = [...docsPlugins, otfw, css, devWorkerAssets];

  // Bundle `input` to a single ESM string in memory (no disk). `external` ids are
  // left as bare imports (resolved by the browser via the import map / route URLs).
  // `alias` lets the runtime build resolve its own `@opentf/web` self-imports.
  //
  // Returns the code plus `deps`: every file this chunk was built from. That is the
  // bundler's own answer — each module it linked, *and* each file a plugin declared
  // through `addWatchFile`. The second half is what a module crawl can't know: the
  // docs sidebar and blog index are generated from the file tree by a plugin, so the
  // chunk holding them depends on page frontmatter and `_meta.*` files it never
  // imports. Invalidation keys off this set (see `invalidateFile`).
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
      // Virtual module ids (`\0…`) aren't files; drop them.
      const deps = new Set((await b.watchFiles).filter((f) => f && !f.startsWith("\0")));
      watchSourceDirs(deps);
      return { code: output[0].code, deps };
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
  // and `@opentf/web` is external (→ import map → /@fw.js). The entry source is
  // regenerated first so the route table can never be stale (or the file missing).
  async function buildEntry() {
    writeEntry();
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
  // compilation at all. A cache entry is `{ code, deps }`; `null` / absent means
  // "needs (re)building".
  let fwChunk = null;
  let entryChunk = null;
  const routeCache = new Map(); // route file → { code, deps }
  const workerCache = new Map(); // worker file → { code, deps }

  // A build error becomes a thrown-on-load stub so the overlay shows it in place.
  const errorStub = (id, msg) =>
    `throw new Error(${JSON.stringify(`Compile error in ${id}\n\n${msg}`)});`;
  // The whole diagnostic as one block of text — position line, message, code frame.
  const diagText = (m) =>
    (m.line ? `${m.file}:${m.line}:${m.column}\n` : "") + m.message + (m.frame ? `\n\n${m.frame}` : "");

  // Compile `file` (framework / entry / route) on demand, surfacing a build failure
  // as a thrown-on-load stub. `build` is the matching builder. The stub is never
  // cached by the callers below: a failed build leaves nothing behind, so the next
  // request retries it — otherwise a transient failure (a half-written file, a
  // missing directory) would stick until the server was restarted.
  async function compileOnce(file, build) {
    try {
      const chunk = await build(file);
      buildErrors.delete(file);
      return { chunk, code: chunk.code };
    } catch (e) {
      // A bundler failure already reads well (it comes with its own code frame), so
      // it goes out as the message — minus the terminal colors, which the overlay
      // would otherwise print literally.
      const msg = errorFrame(file, { message: e?.message ?? String(e) });
      buildErrors.set(file, msg);
      publish(msg);
      return { chunk: null, code: errorStub(file, diagText(msg)) };
    }
  }
  async function serveFramework() {
    if (fwChunk) return fwChunk.code;
    const { chunk, code } = await compileOnce(webEntry, buildFramework);
    if (chunk) fwChunk = chunk;
    return code;
  }
  async function serveEntry() {
    if (entryChunk) return entryChunk.code;
    const { chunk, code } = await compileOnce(entryFile, buildEntry);
    if (chunk) entryChunk = chunk;
    return code;
  }
  async function serveRoute(file) {
    const hit = routeCache.get(file);
    if (hit) return hit.code;
    const { chunk, code } = await compileOnce(file, buildRoute);
    if (chunk) routeCache.set(file, chunk);
    return code;
  }
  async function serveWorker(file) {
    const hit = workerCache.get(file);
    if (hit) return hit.code;
    const { chunk, code } = await compileOnce(file, buildWorker);
    if (chunk) workerCache.set(file, chunk);
    return code;
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

  // Re-read `otfw.config.*` and everything derived from it. A JS config is bundled
  // to a versioned file first (`loadConfig`'s `bust`) because the runtime's ESM cache
  // would otherwise hand back the module as it was when the server started.
  let configVersion = 0;
  async function reloadConfig() {
    config = await loadConfig(root, { bust: ++configVersion, cacheDir: devDir });
    docsPlugins = await loadDocsPlugins(root, appDir, config, exclude, importFresh);
    plugins = [...docsPlugins, otfw, css, devWorkerAssets];
    proxyRules = resolveProxyRules(config);
    for (const r of proxyRules) console.log(`  ↪ proxy ${r.prefix} → ${r.target}`);
  }

  // Nothing is built yet at startup, so no chunk has reported its dependencies —
  // crawl the module graph once, in the background, purely to learn which source
  // directories to watch. From then on every build reports its own (see `bundle`).
  moduleGraph(otfwc, webEntry, [...pages, webEntry])
    .then((g) => watchSourceDirs(g.files()))
    .catch(() => {});

  function clearAllCaches() {
    fwChunk = entryChunk = null;
    routeCache.clear();
    workerCache.clear();
  }

  // Drop exactly the cached chunks that were built from `file` — each one knows the
  // files it came from, so this covers a plain import, a CSS or JSON import, and a
  // file a plugin generated its module from (docs sidebar, blog index).
  //
  // A file no built chunk mentions is one we can't reason about: it was just created
  // (nothing could have listed it yet — and a generated module may well be about to
  // include it, as the docs sidebar does for a new page), or just deleted, or simply
  // isn't part of any chunk. Only the first two matter and both need a rebuild, so
  // clear everything; it costs one recompile of whatever the next page load touches.
  // `public/` is exempt: assets are served straight from disk, never bundled.
  function invalidateFile(file) {
    let known = false;
    const drop = (chunk) => chunk?.deps.has(file) && (known = true);
    if (drop(fwChunk)) fwChunk = null;
    if (drop(entryChunk)) entryChunk = null;
    // A chunk's dependency set includes its own entry module, so editing a worker
    // script drops that worker's chunk through the same check as anything else.
    for (const [f, chunk] of routeCache) if (drop(chunk)) routeCache.delete(f);
    for (const [f, chunk] of workerCache) if (drop(chunk)) workerCache.delete(f);
    if (!known && !file.startsWith(publicDir + sep)) clearAllCaches();
  }

  // ---------------------------------------------------------------- file watching
  //
  // Watched: `app/` (recursively), the project root (`index.html`, `otfw.config.*`),
  // `public/`, and the directory of every module in the graph that lives outside
  // `app/` — a shared `lib/`/`src/` module is a normal part of an app and editing it
  // has to rebuild too. Directories that only ever hold generated or vendored files
  // are skipped so we don't burn watch descriptors (or reload) on them.
  const IGNORED_DIRS = new Set([
    "node_modules", ".git", ".hg", ".svn", "dist", "target", "coverage",
    ".dev", ".otfw", ".otfw-ssg", ".otfw-api", ".otfw-api-build", ".otfw-loaders", ".otfw-loaders-build",
  ]);
  // Editors write through temp/backup files (`.file.swp`, `file~`, `#file#`, vim's
  // `4913` probe); reacting to those means reloading on every keystroke-flush.
  const TEMP_FILE_RE = /(^|\/)(\.#|~\$)|(\.(swp|swx|tmp|temp)|~)$|(^|\/)4913$/;
  const isIgnored = (p) => p.split(sep).some((seg) => IGNORED_DIRS.has(seg));

  const watchers = new Map(); // directory → FSWatcher
  function watchDir(dir, { recursive = false, accept = () => true } = {}) {
    if (watchers.has(dir) || !existsSync(dir)) return;
    try {
      const w = watch(dir, { recursive }, (_evt, name) => {
        if (!name || isIgnored(name) || TEMP_FILE_RE.test(name)) return;
        const file = join(dir, name);
        if (accept(file, name)) queueChange(file);
      });
      w.on?.("error", (e) => console.error(`⚠ file watcher stopped for ${dir}: ${e?.message ?? e}`));
      watchers.set(dir, w);
    } catch (e) {
      console.error(`⚠ could not watch ${dir}: ${e?.message ?? e}`);
    }
  }

  // App sources — every file under `app/`, not just the ones we can name: a page can
  // import a `.json` fixture, an `.svg`, a local `.wasm`.
  watchDir(appDir, { recursive: true });
  // The project root, shallow: only the two files that change what the server serves.
  // A `public/` created later shows up here too, and gets its own watcher.
  watchDir(root, {
    accept: (file, name) => {
      if (name === "public") watchDir(publicDir, { recursive: true });
      return name === "index.html" || CONFIG_FILENAMES.includes(name);
    },
  });
  watchDir(publicDir, { recursive: true });

  // Watch the directories holding the app's modules outside `app/` — a shared `lib/`
  // or `src/`, and (in a monorepo) a workspace package linked into the app, where the
  // module's real path is outside the project root. Installed dependencies and
  // generated output are skipped: anything whose path crosses an ignored directory.
  // Called with each build's dependency set, so a directory starts being watched as
  // soon as something in it is first pulled into a chunk.
  function watchSourceDirs(files) {
    for (const id of files) {
      const dir = dirname(id);
      if (isIgnored(dir) || dir === appDir) continue;
      if (dir.startsWith(appDir + sep)) continue; // covered by the recursive app watcher
      watchDir(dir);
    }
  }

  // Filesystem events arrive in bursts — one save can fire several, and a `git
  // checkout` fires hundreds. Collect them and handle the batch once, so the browser
  // gets a single reload rather than one per event.
  const FLUSH_MS = 40;
  // …but a stream of events that never pauses (a big checkout, a formatter walking the
  // tree) must not defer the reload forever, so the debounce is capped.
  const FLUSH_MAX_MS = 500;
  const pending = new Set();
  let flushTimer = null;
  let queuedAt = 0;
  let flushChain = Promise.resolve();
  function queueChange(file) {
    pending.add(file);
    const now = Date.now();
    if (!queuedAt) queuedAt = now;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(
      () => {
        flushTimer = null;
        queuedAt = 0;
        flushChain = flushChain.then(flush).catch((e) => console.error(`✗ reload failed: ${e?.message ?? e}`));
      },
      Math.max(0, Math.min(FLUSH_MS, queuedAt + FLUSH_MAX_MS - now)),
    );
  }

  const basename = (p) => p.split(sep).pop();
  const IS_API = (n) => /^(route|_middleware)\.(jsx?|tsx?)$/.test(n);
  const IS_LOADER = (n) => /^loader\.(js|ts)$/.test(n);

  async function flush() {
    const files = [...pending];
    pending.clear();
    if (files.length === 0) return;

    for (const file of files) {
      const name = basename(file);
      const inRootDir = dirname(file) === root;
      // A config change can alter anything — the route table (i18n/nav), the docs
      // plugins, the proxy table — so re-read it and rebuild from scratch.
      if (inRootDir && CONFIG_FILENAMES.includes(name)) {
        await reloadConfig();
        clearAllCaches();
        invalidateApi();
        invalidateLoaders();
        continue;
      }
      // `index.html` is read from disk per request; nothing to invalidate.
      if (inRootDir && name === "index.html") continue;
      // An API endpoint/middleware edit rebuilds the API bundle on the next request.
      if (IS_API(name)) {
        invalidateApi();
        continue;
      }
      // A loader edit rebuilds the loader bundle on the next data request; a new or
      // deleted loader.* also changes the route set baked into the entry (a stale set
      // would make SPA nav skip the fetch — or fetch a 404), which `buildEntry`
      // regenerates because the entry cache is dropped below.
      if (IS_LOADER(name)) {
        invalidateLoaders();
        continue;
      }
      invalidateFile(file);
    }

    // The entry is cheap to rebuild and depends on the whole route table (pages,
    // loaders, guard, i18n/nav config), so it's always regenerated — that is what
    // keeps a deleted page from lingering in the route map.
    entryChunk = null;

    // Any diagnostic we're still holding describes code that no longer exists on
    // disk. Drop it (along with the chunks it was recorded for, which may be cached
    // error stubs) and let the reload's fresh compile decide what's broken now —
    // otherwise a fixed error keeps being replayed and the page never reloads.
    if (moduleErrors.size > 0 || buildErrors.size > 0) {
      moduleErrors.clear();
      buildErrors.clear();
      clearAllCaches();
    }

    publish({ type: "reload" });
  }

  const closeWatchers = () => {
    for (const w of watchers.values()) {
      try {
        w.close();
      } catch {}
    }
    watchers.clear();
  };
  // Ctrl+C is the normal way to stop a dev server, so treat it as a clean shutdown
  // (exit 0) rather than the conventional 130 — otherwise `bun run dev` reports it as
  // a failure. The compiler child is torn down by its own `exit` hook.
  const shutdown = () => {
    closeWatchers();
    invalidateApi();
    invalidateLoaders();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => {
    closeWatchers();
    invalidateApi();
    invalidateLoaders();
  });

  // Import map (so `@opentf/web` resolves to the shared runtime chunk) + entry + the
  // dev overlay / reload client. The import map must precede the module script.
  const injected =
    `<script type="importmap">{"imports":{"@opentf/web":"/@fw.js"}}</script>\n` +
    `<script type="module" src="/bundle.js"></script>\n` +
    // The overlay decodes chunk URLs back to file paths; the root lets it show them
    // relative to the project, as an editor would.
    `<script>window.__otfwRoot=${JSON.stringify(root)};${overlayClient}</script>\n`;

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
        // A page that loads *after* a failed build still needs to see the error.
        // (`flush` clears stale diagnostics, so what's here is the current state.)
        const err = firstError();
        if (err) ws.send(JSON.stringify(err));
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
      // `devWorkerAssets`. Both decode a base64url absolute path; we serve only paths
      // that plugin actually emitted a reference to (the allowlist sets), so a crafted
      // `..`/arbitrary URL that was never rewritten can't read files off disk — while a
      // worker/asset in a symlinked dependency (real path outside `root`) still serves.
      if (pathname.startsWith(WORKER_PREFIX) && pathname.endsWith(".js")) {
        const file = fromWorkerUrl(pathname);
        if (!devWorkerFiles.has(file) || !existsSync(file)) return new Response("not found", { status: 404 });
        return js(await serveWorker(file));
      }
      if (pathname.startsWith(ASSET_PREFIX)) {
        const file = fromAssetUrl(pathname);
        if (!devAssetFiles.has(file) || !existsSync(file)) return new Response("not found", { status: 404 });
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
