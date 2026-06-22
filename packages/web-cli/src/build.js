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
  loadDocsNavPlugin,
  loadProject,
  otfwPlugin,
} from "./shared.js";

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
  const navPlugin = await loadDocsNavPlugin(root, appDir, config, exclude);

  const outDir = join(root, "dist");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "assets"), { recursive: true });

  // Write the app entry into a temp dir, then bundle it.
  const tmp = join(root, ".otfw");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "entry.js");
  writeFileSync(entry, entrySource(pages, appDir));

  const result = await build({
    input: entry,
    resolve: { alias: { "@opentf/web": webEntry }, extensions: EXTENSIONS },
    plugins: [
      ...(navPlugin ? [navPlugin] : []),
      otfwPlugin(otfwc, { failOnError: true }),
      cssPlugin(),
    ],
    output: {
      dir: join(outDir, "assets"),
      format: "esm",
      entryFileNames: "bundle-[hash].js",
      chunkFileNames: "[name]-[hash].js",
      minify: true,
    },
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

  // SSG: pre-render each route into static HTML using the shell we just composed
  // (so per-route files carry the same bundle + stylesheet links).
  let ssg = null;
  if (process.argv.includes("--ssg")) {
    const baseUrl = resolveBaseUrl(config);
    const { runPrerender } = await import("./prerender.js");
    ssg = await runPrerender({
      root,
      pages,
      webEntry,
      otfwc,
      shellHtml: html,
      outDir,
      baseUrl,
      navPlugin,
    });
  }

  // Copy the public/ directory (static assets served at the root), if present.
  const publicDir = join(root, "public");
  if (existsSync(publicDir)) cpSync(publicDir, outDir, { recursive: true });

  const chunks = result.output.filter((o) => o.type === "chunk").length;
  const ms = Math.round(performance.now() - t0);
  console.log(`\n  OTF Web build`);
  console.log(`  → dist/  (${pages.length} routes, ${chunks} chunks) in ${ms}ms`);
  if (ssg) {
    console.log(
      `  → pre-rendered ${ssg.count} HTML file(s)` +
        (ssg.skipped.length
          ? `; skipped ${ssg.skipped.length} dynamic route(s) without getStaticPaths`
          : ""),
    );
  }
  console.log("");
}
