// `otfw serve` — the per-request SSR server (Phase 1).
//
// Server-side rendering in OTF Web is *JavaScript at request time*: the Rust
// compiler/toolchain runs only at build time and emits JS render functions; this
// server executes them per request. It reuses the exact path SSG already uses
// (ARCHITECTURE.md §6: "SSR — per-request HTML from the IR … shares the SSG
// path") — `buildServerBundle()` compiles the app with the SSG backend, and each
// request calls the same `renderRoute()` the pre-render loop calls.
//
// Startup:
//   1. produce the client `dist/` (interactive bundle + HTML shell) via `otfw build`
//   2. build the server render bundle once (held live for the process lifetime)
//
// Per request:
//   • a path with a file extension → served from `dist/` (assets, css, public/…)
//   • anything else → SSR: render the route's markup + <head>, inject into the
//     shell, return text/html.
//
// Hydration (Phase 2.0): the client build is the hydrate target and the shell's
// `#app` carries the `data-otfw-hydrate` sentinel, so the client *adopts* the
// server-rendered DOM on first paint (no rebuild/flash) for leaf routes that the
// hydrate backend can emit an adopt factory for; anything it can't (layout chains,
// child components, lists/conditionals — see docs/HYDRATION.md §4) falls back to a
// clean CSR mount. The per-request HTML is real either way (first paint, dynamic
// content, SEO).

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { runBuild } from "./build.js";
import {
  MIME,
  buildServerBundle,
  discoverPages,
  injectHead,
  injectMarkup,
  loadConfig,
  loadDocsPlugins,
  loadProject,
} from "./shared.js";

// Resolve the start port from `--port <n>` / `-p <n>` / `--port=<n>` (args after
// `serve`). Explicit ports are tried once (fail fast if busy); otherwise we
// default to 3000 and scan upward for a free port — mirroring `otfw dev`.
function resolvePort() {
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--port" || a === "-p") && argv[i + 1]) return { port: Number(argv[i + 1]), explicit: true };
    if (a.startsWith("--port=")) return { port: Number(a.slice("--port=".length)), explicit: true };
  }
  return { port: 3000, explicit: false };
}

// Site origin for absolute canonical / OG URLs in the rendered <head>.
function resolveBaseUrl(config) {
  const flag = process.argv.find((a) => a.startsWith("--base-url="));
  if (flag) return flag.slice("--base-url=".length).replace(/\/+$/, "");
  if (config?.site?.url) return String(config.site.url).replace(/\/+$/, "");
  return "";
}

// Start `Bun.serve`, scanning upward for a free port unless one was given explicitly.
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

export async function runServe() {
  const bootStart = Date.now();
  const { port: startPort, explicit: explicitPort } = resolvePort();
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    console.error(`✗ invalid --port value: ${startPort}`);
    process.exit(1);
  }

  // 1. Client build → dist/ (interactive bundle + composed HTML shell). Reusing the
  //    production build keeps the client assets, CSS hashing, and shell identical to
  //    `otfw build`; the SSR server fills the shell's `#app` per request. `hydrate`
  //    builds the dual-module client bundle and stamps the `#app` sentinel, so the
  //    server markup is adopted on first paint instead of rebuilt.
  await runBuild({ hydrate: true });

  // 2. Server render bundle (held live for the process lifetime).
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const distDir = join(root, "dist");
  const shellPath = join(distDir, "index.html");
  if (!existsSync(shellPath)) {
    console.error(`✗ no dist/index.html — the client build did not produce a shell`);
    process.exit(1);
  }
  const shell = readFileSync(shellPath, "utf8");

  const pages = discoverPages(appDir, exclude);
  const config = await loadConfig(root);
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);
  const baseUrl = resolveBaseUrl(config);

  const { mod, cleanup } = await buildServerBundle({ root, pages, webEntry, otfwc, docsPlugins });

  const shutdown = () => {
    try {
      cleanup();
    } catch {}
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => {
    try {
      cleanup();
    } catch {}
  });

  // Serve a built asset from dist/ (only regular files; a directory path falls
  // through to SSR). `dist/` already contains hashed assets, copied public/ files,
  // and any stylesheet output.
  function serveStatic(pathname) {
    const file = join(distDir, pathname);
    if (!file.startsWith(distDir)) return null; // path-traversal guard
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    const ext = pathname.split(".").pop();
    return new Response(readFileSync(file), {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  }

  // SSR one navigation: render the route's markup + <head>, inject into the shell.
  async function render(url) {
    const result = await mod.renderRoute(url.pathname, null, url.search);
    if (!result) {
      const notFound = join(distDir, "404.html");
      const body = existsSync(notFound) ? readFileSync(notFound) : "<h1>404 — Not Found</h1>";
      return new Response(body, { status: 404, headers: { "content-type": "text/html" } });
    }
    const head = mod.renderHead(result.metadata, { path: url.pathname, baseUrl });
    const html = injectMarkup(injectHead(shell, head), result.html);
    // 200 for a real route; 404 when the path fell back to the registered 404 page.
    return new Response(html, {
      status: result.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  }

  const server = serve(startPort, explicitPort, {
    async fetch(req) {
      const url = new URL(req.url);
      // A path with a file extension is an asset request; serve it from dist/. A
      // miss on a real asset is a 404 (don't fall through to the SSR shell).
      if (/\.[a-z0-9]+$/i.test(url.pathname) && url.pathname !== "/") {
        const asset = serveStatic(url.pathname);
        return asset ?? new Response("not found", { status: 404 });
      }
      try {
        return await render(url);
      } catch (e) {
        console.error(`✗ SSR failed for ${url.pathname}: ${e?.message ?? e}`);
        return new Response(`<pre>SSR error: ${e?.message ?? e}</pre>`, {
          status: 500,
          headers: { "content-type": "text/html" },
        });
      }
    },
  });

  console.log(`\n  OTF Web SSR server`);
  console.log(`  → http://localhost:${server.port}  (${pages.length} routes, server-rendered)`);
  console.log(`  ✓ ready in ${Date.now() - bootStart}ms\n`);
}
