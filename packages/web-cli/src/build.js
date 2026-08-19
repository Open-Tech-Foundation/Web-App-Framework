// `otfw build` — the production build.
//
// One-shot bundle (minified, content-hashed, code-split per route) with
// the `otfwc` compiler as a transform plugin, Tailwind stylesheets compiled to
// hashed CSS files, and a static `dist/` emitted from the project's index.html.

import { build } from "runtime:build";
import { hash as digest } from "runtime:hashing";
import { basename, join, toFileURL } from "runtime:path";
import { args, exit } from "runtime:process";

import { copyTree, exists, mkdirp, readText, rmrf, writeFile } from "./runtime.js";
import { compileCss, usesTailwind } from "./tailwind.js";
import {
  EXTENSIONS,
  assertNoRouteConflicts,
  closeCompilers,
  cssPlugin,
  discoverLoaders,
  discoverPages,
  emitApiBundle,
  emitLoaderBundle,
  entrySource,
  injectHead,
  loaderRoutePath,
  injectBeforeBody,
  loadConfig,
  resolveLayoutShellHead,
  loadDocsPlugins,
  loadProject,
  otfwPlugin,
  projectRoot,
  readHtmlShell,
  routeChunkManifest,
  workerAssetsPlugin,
  runBlogFeed,
  runDocsSearchIndex,
  runLlmsFiles,
  runLastUpdated,
  stampHydrateSentinel,
} from "./shared.js";
import { fmtMs, step } from "./reporter.js";

const hash = (s) => digest("xxhash64", s, "hex").padStart(16, "0").slice(0, 8);

// Site origin for absolute canonical / sitemap/feed URLs. Priority: `--base-url=`
// flag, then `otfw.config` (`{ site: { url } }`).
export function resolveBaseUrl(config, argv = args) {
  const flag = argv.find((a) => a.startsWith("--base-url="));
  if (flag) return flag.slice("--base-url=".length).replace(/\/+$/, "");
  if (config?.site?.url) return String(config.site.url).replace(/\/+$/, "");
  return "";
}

// Pull the site-wide description back out of a rendered <head> (CSR builds resolve the
// root layout's metadata into HTML, not an object) so llms.txt can reuse it.
function metaDescriptionFrom(head) {
  const m = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(head ?? "");
  if (!m) return "";
  // renderHead's escapeAttr only encodes `&` and `"` — undo exactly those.
  return m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export function buildRequiresBaseUrl(config, argv = args) {
  return argv.includes("--ssg") || !!config?.docs || !!config?.blog;
}

function requireBaseUrl(config, argv = args) {
  const baseUrl = resolveBaseUrl(config, argv);
  if (baseUrl || !buildRequiresBaseUrl(config, argv)) return baseUrl;
  console.error(
    `✗ site.url is required for this production build.\n` +
      `  Add it to otfw.config.js:\n\n` +
      `  export default defineDocsConfig({\n` +
      `    site: { url: "https://example.com" }\n` +
      `  })\n\n` +
      `  Or pass --base-url=https://example.com`,
  );
  exit(1);
}

export async function runBuild(options = {}) {
  const config = await loadConfig(projectRoot());
  const baseUrl = requireBaseUrl(config);
  const { root, appDir, webEntry, otfwc, exclude } = await loadProject();
  const t0 = performance.now();

  const pages = await discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    exit(1);
  }
  await assertNoRouteConflicts(appDir, exclude);

  // Build the client for hydration when there will be server markup to adopt — the
  // SSR server (`runBuild({ hydrate: true })`) and `--ssg` pre-rendered pages. A
  // plain CSR build mounts into an empty `#app`, so it keeps the leaner CSR bundle.
  const hydrate = options.hydrate ?? args.includes("--ssg");

  // Docs generator: resolve `@opentf/web-docs/nav` to the build-time nav tree when
  // the project has a `docs` config block.
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);

  const outDir = join(root, "dist");
  await rmrf(outDir);
  await mkdirp(join(outDir, "assets"));

  // Write the app entry into a temp dir, then bundle it.
  const tmp = join(root, ".otfw");
  await mkdirp(tmp);
  const entry = join(tmp, "entry.js");
  const loaderFiles = await discoverLoaders(appDir, exclude);
  const loaderRoutes = loaderFiles.map((f) => loaderRoutePath(f, appDir));
  await writeFile(entry, await entrySource(pages, appDir, undefined, config?.i18n, config?.nav, loaderRoutes));

  console.log("\n  OTF Web — production build\n");

  // Phase 1: compile every route/component (jsx/mdx → native DOM) and bundle. The
  // compiler runs as a synchronous subprocess per file, so the per-file `onResult`
  // is what drives the live progress line.
  const buildStep = step("Compiling routes & components");
  let compiled = 0;
  const bundle = await build({
    input: entry,
    resolve: { alias: { "@opentf/web": webEntry }, extensions: EXTENSIONS },
    // Folds the runtime's `DEV` flag to `false` so its dev-only diagnostics
    // (SPEC §5.4.4) are dropped by the minifier below rather than shipped.
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    plugins: [
      ...docsPlugins,
      otfwPlugin(otfwc, {
        failOnError: true,
        target: hydrate ? "hydrate" : "csr",
        onResult: (id) => buildStep.update(`${basename(id)}  (${++compiled})`),
      }),
      cssPlugin(),
      // Emit `new Worker(new URL(…))` scripts + `new URL(…)` assets (.wasm, …) that
      // the bundler would otherwise leave as dangling 404 references. Runs after the
      // compiler so it scans emitted JS.
      workerAssetsPlugin(),
    ],
  });
  let result;
  try {
    result = await bundle.write({
      dir: join(outDir, "assets"),
      format: "esm",
      entryFileNames: "bundle-[hash].js",
      chunkFileNames: "[name]-[hash].js",
      assetFileNames: "[name]-[hash][extname]",
    });
  } finally {
    await bundle.close();
  }
  await rmrf(tmp);

  // The app entry — matched by the module it contains, not just `isEntry`, because
  // emitted worker chunks (workerAssetsPlugin) are entries too and must not be picked
  // here. Chunks carry their module ids; there is no facade id to match on.
  const entryChunk =
    result.output.find((o) => o.type === "chunk" && o.isEntry && o.moduleIds?.includes(entry)) ??
    result.output.find((o) => o.type === "chunk" && o.isEntry);
  const bundleHref = `/assets/${entryChunk.fileName}`;

  // Which chunks each route's first paint needs, so the pre-rendered/SSR'd HTML can
  // hint them with `<link rel="modulepreload">` instead of leaving the browser to
  // discover them only after `bundle.js` has downloaded and run. Only meaningful when
  // there's server-rendered HTML per route — a CSR build serves one shell for all of them.
  const chunkManifest = hydrate
    ? routeChunkManifest({ output: result.output, pages, appDir, entryFileName: entryChunk.fileName })
    : null;

  // Compose dist/index.html from the project shell: strip module entry scripts,
  // compile + hash any local stylesheet links, and inject the bundle. When the
  // client was built for hydration, stamp the `#app` sentinel so the client adopts
  // the server markup (this shell is also the SSG pre-render template, so each
  // pre-rendered page inherits the sentinel).
  let html = await readHtmlShell(root);
  if (hydrate) html = stampHydrateSentinel(html);

  // Compile each local <link rel="stylesheet" href="/..."> and rewrite the href.
  buildStep.update("styles");
  const links = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  for (const [, href] of links) {
    if (!href.startsWith("/")) continue; // leave external/CDN links alone
    const src = join(root, href);
    if (!(await exists(src))) continue;
    const raw = await readText(src);
    const css = usesTailwind(raw) ? await compileCss(src, raw, root) : raw;
    const name = basename(href).replace(/\.css$/, "");
    const out = `${name}-${hash(css)}.css`;
    await writeFile(join(outDir, "assets", out), css);
    html = html.replaceAll(href, `/assets/${out}`);
  }

  // Plain CSR: the single index.html shell is shared by every route, so inject the
  // root layout's route-independent metadata (favicon/other links, site-wide
  // description, Open Graph site defaults) — but never a per-page title/canonical.
  // SSG/SSR inject a full per-route <head> instead, so this is CSR-only (`!hydrate`).
  let siteDescription = ""; // the site's own <meta name="description"> (feeds llms.txt)
  if (!hydrate) {
    const layoutHead = await resolveLayoutShellHead({
      root, appDir, pages, webEntry, otfwc, docsPlugins, baseUrl,
    });
    if (layoutHead) {
      html = injectHead(html, layoutHead);
      siteDescription = metaDescriptionFrom(layoutHead);
    }
  }

  const script = `<script type="module" src="${bundleHref}"></script>\n`;
  html = injectBeforeBody(html, script);
  await writeFile(join(outDir, "index.html"), html);

  // Persist the manifest for `otfw serve`: SSR renders each navigation at request time,
  // so it needs the same route → chunk mapping the SSG pass uses below.
  if (chunkManifest) {
    await writeFile(join(outDir, "server", "preload.json"), JSON.stringify(chunkManifest));
  }

  const chunks = result.output.filter((o) => o.type === "chunk").length;
  buildStep.done(`Compiled ${pages.length} routes · bundled ${chunks} chunks`);

  // Route loaders (docs/DATA.md): emit the server bundle to dist/server/loaders.js
  // — `otfw serve` imports it per request, and the SSG pre-render below runs it at
  // build time (so this must precede the SSG step).
  let loaders = null;
  if (loaderFiles.length > 0) {
    const loaderStep = step("Bundling route loaders");
    await emitLoaderBundle({
      root,
      appDir,
      webEntry,
      exclude,
      i18n: config?.i18n,
      outDir: join(outDir, "server"),
    });
    loaders = (await import(toFileURL(join(outDir, "server", "loaders.js")).href)).loaders;
    loaderStep.done(`Route loaders — ${loaderFiles.length} → dist/server/loaders.js`);
  }

  // SSG: pre-render each route into static HTML using the shell we just composed
  // (so per-route files carry the same bundle + stylesheet links).
  let ssg = null;
  if (args.includes("--ssg")) {
    const { runPrerender } = await import("./prerender.js");
    // Per-page last-updated map (git/frontmatter) for the article:modified_time tag.
    const lastUpdated = await runLastUpdated(root, appDir, config, exclude);
    const ssgStep = step("Pre-rendering pages");
    let ssgCompiled = 0;
    ssg = await runPrerender({
      root,
      pages,
      webEntry,
      otfwc,
      shellHtml: html,
      outDir,
      baseUrl,
      docsPlugins,
      lastUpdated,
      i18n: config?.i18n,
      loaders,
      chunkManifest,
      onCompile: (id) => ssgStep.update(`compiling ${basename(id)}  (${++ssgCompiled})`),
      onRender: (done, total) => ssgStep.update(`rendering ${done}/${total}`),
    });
    ssgStep.done(
      `Pre-rendered ${ssg.count} page(s)` +
        (ssg.skipped.length ? ` · ${ssg.skipped.length} dynamic route(s) skipped` : ""),
    );
  }

  // API routes (SPEC §11/§13): emit the server handler bundle to dist/server/api.js
  // so a deploy adapter (Bun/Node/CF Workers) can serve /api/* in production.
  const apiStep = step("Bundling API routes");
  const api = await emitApiBundle({
    root,
    appDir,
    webEntry,
    exclude,
    i18n: config?.i18n,
    outDir: join(outDir, "server"),
  });
  const apiNote = api
    ? `API routes — ${api.routes.length}${api.middleware.length ? ` (+${api.middleware.length} middleware)` : ""} → dist/server/api.js`
    : "API routes — none";
  apiStep.done(apiNote);

  // Copy the public/ directory (static assets served at the root), if present.
  const publicDir = join(root, "public");
  if (await exists(publicDir)) await copyTree(publicDir, outDir);

  // Docs search: index the pre-rendered HTML with Pagefind (when SSG + opted in).
  let search = null;
  if (ssg && config?.docs?.search?.provider === "pagefind") {
    const searchStep = step("Building search index");
    search = await runDocsSearchIndex(root, config, outDir, (done, total) =>
      searchStep.update(`${done}/${total} pages`),
    );
    searchStep.done(`Search index — ${search?.pages ?? 0} page(s)`);
  }

  // Blog RSS + Atom feeds (when a `blog` block is configured). Written
  // after the public/ copy so project-supplied feed overrides aren't clobbered.
  if (config?.blog) {
    const feedStep = step("Generating blog feeds");
    const feed = await runBlogFeed(root, appDir, config, outDir, baseUrl, exclude);
    if (feed) feedStep.done(`Blog feeds — ${feed.count} post(s) → ${feed.paths.join(", ")}`);
    else feedStep.done("Blog feeds — skipped");
  }

  if (config?.docs || config?.blog) {
    const llmsStep = step("Generating LLM context");
    const llms = await runLlmsFiles(root, appDir, pages, config, outDir, baseUrl, {
      siteDescription: ssg?.siteDescription || siteDescription,
    });
    if (llms) llmsStep.done(`LLM context — ${llms.paths.join(", ")}`);
    else llmsStep.done("LLM context — skipped");
  }

  // Stop the `otfwc serve` children. Nothing else references them, but an open
  // reader on a child's stdout keeps the runtime alive — so this is what lets a
  // finished build actually exit.
  await closeCompilers();

  console.log(`\n  → dist/  ready in ${fmtMs(performance.now() - t0)}\n`);
}
