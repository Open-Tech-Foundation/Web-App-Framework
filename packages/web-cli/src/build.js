// `otfw build` — the production build.
//
// One-shot Rolldown bundle (minified, content-hashed, code-split per route) with
// the `otfwc` compiler as a transform plugin, Tailwind stylesheets compiled to
// hashed CSS files, and a static `dist/` emitted from the project's index.html.

import { build } from "rolldown";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { compileCss, usesTailwind } from "./tailwind.js";
import {
  EXTENSIONS,
  assertNoRouteConflicts,
  cssPlugin,
  discoverLoaders,
  discoverPages,
  emitApiBundle,
  emitLoaderBundle,
  entrySource,
  loaderRoutePath,
  injectBeforeBody,
  loadConfig,
  loadDocsPlugins,
  loadProject,
  otfwPlugin,
  readHtmlShell,
  runBlogFeed,
  runDocsSearchIndex,
  runLlmsFiles,
  runLastUpdated,
  stampHydrateSentinel,
} from "./shared.js";
import { fmtMs, step } from "./reporter.js";

const hash = (s) => Bun.hash(s).toString(16).padStart(16, "0").slice(0, 8);

// Site origin for absolute canonical / sitemap/feed URLs. Priority: `--base-url=`
// flag, then `otfw.config` (`{ site: { url } }`).
export function resolveBaseUrl(config, argv = process.argv) {
  const flag = argv.find((a) => a.startsWith("--base-url="));
  if (flag) return flag.slice("--base-url=".length).replace(/\/+$/, "");
  if (config?.site?.url) return String(config.site.url).replace(/\/+$/, "");
  return "";
}

export function buildRequiresBaseUrl(config, argv = process.argv) {
  return argv.includes("--ssg") || !!config?.docs || !!config?.blog;
}

function requireBaseUrl(config, argv = process.argv) {
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
  process.exit(1);
}

export async function runBuild(options = {}) {
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const baseUrl = requireBaseUrl(config);
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const t0 = performance.now();

  const pages = discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    process.exit(1);
  }
  assertNoRouteConflicts(appDir, exclude);

  // Build the client for hydration when there will be server markup to adopt — the
  // SSR server (`runBuild({ hydrate: true })`) and `--ssg` pre-rendered pages. A
  // plain CSR build mounts into an empty `#app`, so it keeps the leaner CSR bundle.
  const hydrate = options.hydrate ?? process.argv.includes("--ssg");

  // Docs generator: resolve `@opentf/web-docs/nav` to the build-time nav tree when
  // the project has a `docs` config block.
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);

  const outDir = join(root, "dist");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "assets"), { recursive: true });

  // Write the app entry into a temp dir, then bundle it.
  const tmp = join(root, ".otfw");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "entry.js");
  const loaderFiles = discoverLoaders(appDir, exclude);
  const loaderRoutes = loaderFiles.map((f) => loaderRoutePath(f, appDir));
  writeFileSync(entry, entrySource(pages, appDir, undefined, config?.i18n, config?.nav, loaderRoutes));

  console.log("\n  OTF Web — production build\n");

  // Phase 1: compile every route/component (jsx/mdx → native DOM) and bundle. The
  // compiler runs as a synchronous subprocess per file, so the per-file `onResult`
  // is what drives the live progress line.
  const buildStep = step("Compiling routes & components");
  let compiled = 0;
  const result = await build({
    input: entry,
    resolve: { alias: { "@opentf/web": webEntry }, extensions: EXTENSIONS },
    plugins: [
      ...docsPlugins,
      otfwPlugin(otfwc, {
        failOnError: true,
        target: hydrate ? "hydrate" : "csr",
        onResult: (id) => buildStep.update(`${basename(id)}  (${++compiled})`),
      }),
      cssPlugin(),
    ],
    output: {
      dir: join(outDir, "assets"),
      format: "esm",
      entryFileNames: "bundle-[hash].js",
      chunkFileNames: "[name]-[hash].js",
      minify: true,
    },
    // The compiler runs a subprocess per file, so it dominates plugin time by design;
    // silence Rolldown's plugin-timing advisory rather than print it every build.
    checks: { pluginTimings: false },
  });
  rmSync(tmp, { recursive: true, force: true });

  const entryChunk = result.output.find((o) => o.type === "chunk" && o.isEntry);
  const bundleHref = `/assets/${entryChunk.fileName}`;

  // Compose dist/index.html from the project shell: strip module entry scripts,
  // compile + hash any local stylesheet links, and inject the bundle. When the
  // client was built for hydration, stamp the `#app` sentinel so the client adopts
  // the server markup (this shell is also the SSG pre-render template, so each
  // pre-rendered page inherits the sentinel).
  let html = readHtmlShell(root);
  if (hydrate) html = stampHydrateSentinel(html);

  // Compile each local <link rel="stylesheet" href="/..."> and rewrite the href.
  buildStep.update("styles");
  const links = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  for (const [, href] of links) {
    if (!href.startsWith("/")) continue; // leave external/CDN links alone
    const src = join(root, href);
    if (!existsSync(src)) continue;
    const raw = readFileSync(src, "utf8");
    const css = usesTailwind(raw) ? await compileCss(src, raw, root) : raw;
    const name = basename(href).replace(/\.css$/, "");
    const out = `${name}-${hash(css)}.css`;
    writeFileSync(join(outDir, "assets", out), css);
    html = html.replaceAll(href, `/assets/${out}`);
  }

  const script = `<script type="module" src="${bundleHref}"></script>\n`;
  html = injectBeforeBody(html, script);
  writeFileSync(join(outDir, "index.html"), html);

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
    loaders = (await import(pathToFileURL(join(outDir, "server", "loaders.js")).href)).loaders;
    loaderStep.done(`Route loaders — ${loaderFiles.length} → dist/server/loaders.js`);
  }

  // SSG: pre-render each route into static HTML using the shell we just composed
  // (so per-route files carry the same bundle + stylesheet links).
  let ssg = null;
  if (process.argv.includes("--ssg")) {
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
  if (existsSync(publicDir)) cpSync(publicDir, outDir, { recursive: true });

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
    const llms = await runLlmsFiles(root, appDir, pages, config, outDir, baseUrl);
    if (llms) llmsStep.done(`LLM context — ${llms.paths.join(", ")}`);
    else llmsStep.done("LLM context — skipped");
  }

  console.log(`\n  → dist/  ready in ${fmtMs(performance.now() - t0)}\n`);
}
