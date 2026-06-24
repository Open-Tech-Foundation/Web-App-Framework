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

import { compileCss, usesTailwind } from "./tailwind.js";
import {
  EXTENSIONS,
  cssPlugin,
  discoverPages,
  entrySource,
  loadConfig,
  loadDocsPlugins,
  loadProject,
  otfwPlugin,
  runBlogFeed,
  runDocsSearchIndex,
} from "./shared.js";
import { fmtMs, step } from "./reporter.js";

const hash = (s) => Bun.hash(s).toString(16).padStart(16, "0").slice(0, 8);

// Site origin for absolute canonical / sitemap URLs. Priority: `--base-url=` flag,
// then `otfw.config` (`{ site: { url } }`), else "" (relative canonicals, sitemap
// skipped with a warning).
function resolveBaseUrl(config) {
  const flag = process.argv.find((a) => a.startsWith("--base-url="));
  if (flag) return flag.slice("--base-url=".length).replace(/\/+$/, "");
  if (config?.site?.url) return String(config.site.url).replace(/\/+$/, "");
  return "";
}

export async function runBuild() {
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const t0 = performance.now();

  const pages = discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    process.exit(1);
  }

  // Docs generator: resolve `@opentf/web-docs/nav` to the build-time nav tree when
  // the project has a `docs` config block.
  const config = await loadConfig(root);
  const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);

  const outDir = join(root, "dist");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "assets"), { recursive: true });

  // Write the app entry into a temp dir, then bundle it.
  const tmp = join(root, ".otfw");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "entry.js");
  writeFileSync(entry, entrySource(pages, appDir));

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
  // compile + hash any local stylesheet links, and inject the bundle.
  const indexPath = join(root, "index.html");
  let html = existsSync(indexPath)
    ? readFileSync(indexPath, "utf8")
    : `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OTF Web</title></head><body><div id="app"></div></body></html>`;

  html = html.replace(
    /<script\s+type=["']module["'][^>]*src=[^>]*>\s*<\/script>\s*/gi,
    "",
  );

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
  html = html.includes("</body>")
    ? html.replace("</body>", `${script}</body>`)
    : html + script;
  writeFileSync(join(outDir, "index.html"), html);

  const chunks = result.output.filter((o) => o.type === "chunk").length;
  buildStep.done(`Compiled ${pages.length} routes · bundled ${chunks} chunks`);

  // SSG: pre-render each route into static HTML using the shell we just composed
  // (so per-route files carry the same bundle + stylesheet links).
  let ssg = null;
  if (process.argv.includes("--ssg")) {
    const baseUrl = resolveBaseUrl(config);
    const { runPrerender } = await import("./prerender.js");
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
      onCompile: (id) => ssgStep.update(`compiling ${basename(id)}  (${++ssgCompiled})`),
      onRender: (done, total) => ssgStep.update(`rendering ${done}/${total}`),
    });
    ssgStep.done(
      `Pre-rendered ${ssg.count} page(s)` +
        (ssg.skipped.length ? ` · ${ssg.skipped.length} dynamic route(s) skipped` : ""),
    );
  }

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

  // Blog RSS feed (when a `blog` block + site URL are configured). Written after the
  // public/ copy so a project-supplied feed override isn't clobbered.
  if (config?.blog) {
    const feedStep = step("Generating RSS feed");
    const feed = await runBlogFeed(root, appDir, config, outDir, resolveBaseUrl(config), exclude);
    if (feed) feedStep.done(`RSS feed — ${feed.count} post(s) → ${feed.path}`);
    else feedStep.done("RSS feed — skipped");
  }

  console.log(`\n  → dist/  ready in ${fmtMs(performance.now() - t0)}\n`);
}
