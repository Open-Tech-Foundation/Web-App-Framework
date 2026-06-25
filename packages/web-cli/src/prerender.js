// SSG pre-render (ARCHITECTURE.md §6): build a *server* bundle of the app with the
// compiler's SSG backend (HTML-string renderers), then run it in plain Bun to
// render each route to a static HTML file. No DOM — the SSG output is pure string
// concatenation, so no effects/lifecycle run.

import { build } from "rolldown";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { EXTENSIONS, cssPlugin, otfwPlugin } from "./shared.js";

// Generated server entry: eager-import every page module (so registerRoutes sees
// real namespaces, enabling getStaticPaths) and re-export the render API.
function serverEntrySource(pages) {
  const imports = pages.map((p, i) => `import * as p${i} from ${JSON.stringify(p)};`).join("\n");
  const map = pages.map((p, i) => `  [${JSON.stringify(p)}]: p${i},`).join("\n");
  return (
    `${imports}\n` +
    `import { registerRoutes } from "@opentf/web";\n` +
    `export { renderRoute, renderHead, collectRoutePaths } from "@opentf/web/server";\n` +
    `registerRoutes({\n${map}\n});\n`
  );
}

// Inject pre-rendered markup into the shell's #app container.
function injectMarkup(shellHtml, markup) {
  return shellHtml.replace(/(<div id="app"[^>]*>)\s*(<\/div>)/, `$1${markup}$2`);
}

// Inject per-route <head> tags before </head>, dropping the shell's default <title>
// when the route supplies its own (so each page gets a unique, non-duplicated title).
function injectHead(shellHtml, headHtml) {
  if (!headHtml) return shellHtml;
  let out = shellHtml;
  if (/<title[\s>]/i.test(headHtml)) out = out.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  return out.replace(/<\/head>/i, `${headHtml}\n</head>`);
}

// "/" → dist/index.html, "/post/1" → dist/post/1/index.html.
function htmlPathFor(outDir, route) {
  return route === "/" ? join(outDir, "index.html") : join(outDir, route, "index.html");
}

// Absolute URL for sitemap/robots; "" if no base URL configured.
function absoluteUrl(baseUrl, path) {
  if (!baseUrl) return "";
  return baseUrl.replace(/\/+$/, "") + (path === "/" ? "/" : path);
}

// Emit sitemap.xml (absolute <loc> per rendered path) — requires a base URL. A
// project-supplied public/sitemap.xml takes precedence (it overwrites ours on copy).
function writeSitemap(outDir, publicDir, baseUrl, paths) {
  if (existsSync(join(publicDir, "sitemap.xml"))) return false;
  if (!baseUrl) {
    console.warn("⚠ sitemap.xml skipped: no site URL (pass --base-url or set otfw.config)");
    return false;
  }
  const urls = paths
    .map((p) => `  <url><loc>${escapeXml(absoluteUrl(baseUrl, p))}</loc></url>`)
    .join("\n");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  writeFileSync(join(outDir, "sitemap.xml"), xml);
  return true;
}

// Emit a permissive robots.txt referencing the sitemap (honor a public/ override).
function writeRobots(outDir, publicDir, baseUrl, hasSitemap) {
  if (existsSync(join(publicDir, "robots.txt"))) return false;
  let body = "User-agent: *\nAllow: /\n";
  if (baseUrl && hasSitemap) body += `Sitemap: ${absoluteUrl(baseUrl, "/sitemap.xml")}\n`;
  writeFileSync(join(outDir, "robots.txt"), body);
  return true;
}

function escapeXml(s) {
  return String(s).replace(/[&<>'"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/**
 * Pre-render the app to static HTML files under `outDir`. Returns
 * `{ count, skipped, failed }`.
 */
export async function runPrerender({ root, pages, webEntry, otfwc, shellHtml, outDir, baseUrl = "", docsPlugins = [], lastUpdated = {}, onCompile, onRender }) {
  const tmp = join(root, ".otfw-ssg");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "ssg-entry.js");
  writeFileSync(entry, serverEntrySource(pages));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  await build({
    input: entry,
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    plugins: [
      ...docsPlugins,
      otfwPlugin(otfwc, { failOnError: true, target: "ssg", onResult: (id) => onCompile?.(id) }),
      cssPlugin(),
    ],
    output: { dir: join(tmp, "out"), format: "esm", entryFileNames: "server.js" },
    checks: { pluginTimings: false },
  });

  // The runtime defines `class … extends HTMLElement` at load (for CSR custom
  // elements). SSG never instantiates them, but the base class must exist so the
  // class definitions evaluate. A bare stub suffices — no DOM (customElements
  // stays undefined, so the elements self-register only in the browser).
  globalThis.HTMLElement ??= class {};
  const mod = await import(pathToFileURL(join(tmp, "out", "server.js")).href);

  const { paths, skipped } = await mod.collectRoutePaths();
  const failed = [];
  const rendered = []; // concrete paths that produced an HTML file (for the sitemap)
  let renderedCount = 0;
  for (const { path, params } of paths) {
    onRender?.(++renderedCount, paths.length);
    try {
      const { html, metadata } = (await mod.renderRoute(path, params)) ?? { html: "", metadata: {} };
      let head = mod.renderHead(metadata, { path, baseUrl });
      // SEO: expose the page's last-updated time (git/frontmatter) as Open Graph's
      // article:modified_time so crawlers see when the content actually changed.
      const iso = lastUpdated[path];
      if (iso) head += `\n<meta property="article:modified_time" content="${escapeXml(iso)}">`;
      const file = htmlPathFor(outDir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, injectMarkup(injectHead(shellHtml, head), html));
      rendered.push(path);
    } catch (e) {
      failed.push(path);
      console.error(`✗ pre-render failed for ${path}: ${e?.message ?? e}`);
    }
  }

  // 404: any unmatched path resolves to the registered 404 page. Mark noindex so
  // crawlers don't index the error page, and keep it out of the sitemap.
  try {
    const result = await mod.renderRoute("/__otfw_404__");
    if (result) {
      const head = mod.renderHead({ robots: "noindex", ...result.metadata }, { baseUrl });
      writeFileSync(join(outDir, "404.html"), injectMarkup(injectHead(shellHtml, head), result.html));
    }
  } catch {
    /* no 404 page */
  }

  // Crawl infrastructure: sitemap.xml + robots.txt (honoring public/ overrides).
  const publicDir = join(root, "public");
  const hasSitemap = writeSitemap(outDir, publicDir, baseUrl, rendered);
  writeRobots(outDir, publicDir, baseUrl, hasSitemap);

  rmSync(tmp, { recursive: true, force: true });
  return { count: rendered.length, skipped, failed };
}
