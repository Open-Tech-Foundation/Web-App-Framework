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
// Hydration (Phase 2, complete — docs/HYDRATION.md §4): the client build is the
// hydrate target and the shell's `#app` carries the `data-otfw-hydrate` sentinel,
// so the client *adopts* the server-rendered DOM on first paint (no rebuild/flash)
// — pages, layout chains, keyed lists, conditionals, and component islands with
// rich props (2.0/2.5/2.1a–d). A route the adopt walk can't handle falls back to
// a clean CSR mount per component. The per-request HTML is real either way (first
// paint, dynamic content, SEO).

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runBuild } from "./build.js";
import {
  MIME,
  buildServerBundle,
  discoverApiRoutes,
  discoverPages,
  injectHead,
  injectHydrationData,
  injectMarkup,
  injectRouteData,
  loadConfig,
  loadDocsPlugins,
  loadProject,
  withHtmlLang,
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

  // i18n (docs/I18N.md §6): URL path-prefix locale routing. The server pins the
  // locale from the prefix (renderRoute does this via resolveLocale), emits per-locale
  // <html lang> + hreflang, and detect-redirects bare paths for non-default visitors.
  const i18n = config?.i18n;
  const i18nOn = !!(i18n && Array.isArray(i18n.locales) && i18n.locales.length);
  const nonDefault = i18nOn ? new Set(i18n.locales.filter((l) => l !== i18n.defaultLocale)) : null;

  const localeOf = (pathname) =>
    i18nOn && nonDefault.has(pathname.split("/")[1]) ? pathname.split("/")[1] : i18n?.defaultLocale ?? null;
  const stripLocale = (pathname) => {
    if (!i18nOn || !nonDefault.has(pathname.split("/")[1])) return pathname;
    const rest = "/" + pathname.split("/").slice(2).join("/");
    return rest === "/" ? "/" : rest.replace(/\/$/, "");
  };
  const localizeFor = (path, locale) =>
    !locale || locale === i18n.defaultLocale ? path : path === "/" ? `/${locale}` : `/${locale}${path}`;
  const alternatesFor = (path) => [
    ...i18n.locales.map((l) => ({ rel: "alternate", hreflang: l, href: localizeFor(path, l) })),
    { rel: "alternate", hreflang: "x-default", href: localizeFor(path, i18n.defaultLocale) },
  ];
  // Pick a preferred locale from a Cookie override or Accept-Language, else null.
  const detectLocale = (req) => {
    if (!i18nOn) return null;
    const cookie = /(?:^|;\s*)otfw_locale=([^;]+)/.exec(req.headers.get("cookie") || "")?.[1];
    if (cookie && i18n.locales.includes(cookie)) return cookie;
    const accept = req.headers.get("accept-language");
    if (!accept) return null;
    for (const part of accept.split(",")) {
      const tag = part.split(";")[0].trim().toLowerCase();
      const hit = i18n.locales.find((l) => l.toLowerCase() === tag || l.toLowerCase() === tag.split("-")[0]);
      if (hit) return hit;
    }
    return null;
  };

  const { mod, cleanup } = await buildServerBundle({ root, pages, webEntry, otfwc, docsPlugins, i18n });

  // API routes (SPEC §11): the client build already emitted the handler bundle to
  // dist/server/api.js (build.js `emitApiBundle`). Import it and hold it live;
  // `apiHandler(req)` returns a Response or null (no route matched).
  const apiFile = join(distDir, "server", "api.js");
  let api = null;
  if (existsSync(apiFile)) {
    const apiMod = await import(pathToFileURL(apiFile).href);
    api = { handler: apiMod.apiHandler, routes: discoverApiRoutes(appDir, exclude).routes };
  }

  // Route loaders (docs/DATA.md): the client build emitted the registry bundle to
  // dist/server/loaders.js (build.js `emitLoaderBundle`). Import it and hold it
  // live; per request it runs the matched page's loader (threaded into the render
  // as `router.data`) and answers the `<path>/__data.json` endpoint.
  const loadersFile = join(distDir, "server", "loaders.js");
  const loaders = existsSync(loadersFile)
    ? (await import(pathToFileURL(loadersFile).href)).loaders
    : null;

  const cleanupAll = () => {
    try {
      cleanup();
    } catch {}
  };
  const shutdown = () => {
    cleanupAll();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", cleanupAll);

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

  // The 404 response: the pre-built dist/404.html when present, else a bare body.
  function renderNotFound() {
    const notFound = join(distDir, "404.html");
    const body = existsSync(notFound) ? readFileSync(notFound) : "<h1>404 — Not Found</h1>";
    return new Response(body, { status: 404, headers: { "content-type": "text/html" } });
  }

  // SSR one navigation: run the route's loader (if any), render the markup +
  // <head>, inject into the shell.
  async function render(url, req) {
    // Loader first — `notFound()` must resolve before anything renders. The check
    // is a property (`otfwNotFound`), not instanceof: the loader bundle is its own
    // module graph. On notFound, re-render as the unmatched sentinel path so the
    // registered 404 page is served with HTTP 404 (same as a route miss). Any
    // other loader throw propagates to the 500 branch in `fetch`.
    let data;
    let dataJson = "";
    const m = loaders?.match(url.pathname);
    if (m) {
      try {
        ({ data, json: dataJson } = await loaders.loadSerialized(m, {
          request: req,
          query: Object.fromEntries(url.searchParams),
        }));
      } catch (e) {
        if (e?.otfwNotFound === true) return render(new URL("/__otfw_404__", url), req);
        throw e;
      }
    }
    const result = await mod.renderRoute(url.pathname, null, url.search, { data });
    if (!result) return renderNotFound();
    const meta = i18nOn
      ? { ...result.metadata, links: [...(result.metadata.links || []), ...alternatesFor(stripLocale(url.pathname))] }
      : result.metadata;
    const head = mod.renderHead(meta, { path: url.pathname, baseUrl });
    const localizedShell = i18nOn ? withHtmlLang(shell, localeOf(url.pathname)) : shell;
    const html = injectRouteData(
      injectHydrationData(injectMarkup(injectHead(localizedShell, head), result.html), result.hydration),
      dataJson,
    );
    // 200 for a real route; 404 when the path fell back to the registered 404 page.
    return new Response(html, {
      status: result.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  }

  const server = serve(startPort, explicitPort, {
    async fetch(req) {
      const url = new URL(req.url);
      // API endpoints (route.* files, at any path — SPEC §11) are checked first —
      // before the asset branch, matching `otfw dev` — so an endpoint path with a
      // dotted segment (`/api/v1.0`) still resolves. A matched handler's Response
      // wins; a miss falls through to assets / SSR, so pages and endpoints coexist.
      if (api) {
        const res = await api.handler(req);
        if (res) return res;
      }
      // The route-loader data endpoint (docs/DATA.md): `<path>/__data.json` is a
      // reserved suffix, answered before the asset branch below would swallow it
      // (it has a file extension) and never falling through to SSR (a catch-all
      // page would happily match the suffix as a path segment) — a miss is a 404.
      if (url.pathname === "/__data.json" || url.pathname.endsWith("/__data.json")) {
        const res = loaders ? await loaders.handle(req) : null;
        return res ?? Response.json(null, { status: 404 });
      }
      // A path with a file extension is an asset request; serve it from dist/. A
      // miss on a real asset is a 404 (don't fall through to the SSR shell).
      if (/\.[a-z0-9]+$/i.test(url.pathname) && url.pathname !== "/") {
        const asset = serveStatic(url.pathname);
        return asset ?? new Response("not found", { status: 404 });
      }
      // Locale detection: a bare path (no locale prefix) whose visitor prefers a
      // non-default locale is redirected to the prefixed URL. The default locale
      // serves bare, so an `en` visitor is never redirected (no loop).
      if (i18nOn && localeOf(url.pathname) === i18n.defaultLocale) {
        const pref = detectLocale(req);
        if (pref && pref !== i18n.defaultLocale) {
          const target = localizeFor(stripLocale(url.pathname), pref) + url.search;
          return new Response(null, { status: 302, headers: { location: target } });
        }
      }
      try {
        return await render(url, req);
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
  const apiNote = api ? `, ${api.routes.length} API routes` : "";
  const loaderNote = loaders ? `, ${loaders.routes.length} loaders` : "";
  console.log(`  → http://localhost:${server.port}  (${pages.length} routes, server-rendered${apiNote}${loaderNote})`);
  console.log(`  ✓ ready in ${Date.now() - bootStart}ms\n`);
}
