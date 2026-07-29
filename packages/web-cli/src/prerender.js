// SSG pre-render (ARCHITECTURE.md §6): build a *server* bundle of the app with the
// compiler's SSG backend (HTML-string renderers), then run it in plain Bun to
// render each route to a static HTML file. No DOM — the SSG output is pure string
// concatenation, so no effects/lifecycle run.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  DATA_FILE,
  buildServerBundle,
  injectHead,
  injectHydrationData,
  injectMarkup,
  injectRouteData,
  modulepreloadTags,
  withHtmlLang,
} from "./shared.js";

// "/" → dist/index.html, "/post/1" → dist/post/1/index.html, "/fr/about" → dist/fr/about/index.html.
function htmlPathFor(outDir, route) {
  return route === "/" ? join(outDir, "index.html") : join(outDir, route, "index.html");
}

// Prefix a locale-agnostic route with `locale` (bare for the default) — the URL form
// that both selects the output file and, passed to renderRoute, pins router.locale.
function localizeFor(path, locale, defaultLocale) {
  if (!locale || locale === defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

// `rel="alternate" hreflang` descriptors for a route across all locales (+ x-default),
// merged into metadata.links so renderHead emits them (docs/I18N.md §6).
function alternatesFor(path, locales, defaultLocale) {
  const links = locales.map((l) => ({
    rel: "alternate",
    hreflang: l,
    href: localizeFor(path, l, defaultLocale),
  }));
  links.push({ rel: "alternate", hreflang: "x-default", href: localizeFor(path, defaultLocale, defaultLocale) });
  return links;
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
export async function runPrerender({ root, pages, webEntry, otfwc, shellHtml, outDir, baseUrl = "", docsPlugins = [], lastUpdated = {}, i18n = null, loaders = null, chunkManifest = null, onCompile, onRender }) {
  const { mod, cleanup } = await buildServerBundle({ root, pages, webEntry, otfwc, docsPlugins, i18n, onCompile });

  // i18n (docs/I18N.md §6): pre-render each route once per locale. The default
  // locale is emitted bare (dist/<route>/index.html), others under their prefix
  // (dist/<locale>/<route>/index.html). A single `[null]` means i18n is off — the
  // loop collapses to the original one-render-per-route behavior.
  const i18nOn = !!(i18n && Array.isArray(i18n.locales) && i18n.locales.length);
  const locales = i18nOn ? i18n.locales : [null];
  const defaultLocale = i18nOn ? i18n.defaultLocale : null;

  const { paths, skipped } = await mod.collectRoutePaths();

  // `<link rel="modulepreload">` for the page + layout chunks this route will import,
  // so the browser fetches them in parallel with `bundle.js` rather than after it.
  const preloadFor = (route) => modulepreloadTags(chunkManifest?.routes?.[route]);
  const failed = [];
  const rendered = []; // concrete paths that produced an HTML file (for the sitemap)
  let renderedCount = 0;
  for (const { path, params, route } of paths) {
    onRender?.(++renderedCount, paths.length);
    for (const locale of locales) {
      const urlPath = localizeFor(path, locale, defaultLocale);
      try {
        // Route loader (docs/DATA.md): run it at build time with no `request` and
        // an empty query (a query-dependent loader needs `otfw serve`). The result
        // is threaded into the render (`router.data`), inlined into the HTML, and
        // written as a sibling `__data.json` — per locale, since a localized
        // loader can return locale-dependent data.
        const m = loaders?.match(urlPath);
        let data;
        let dataJson = "";
        if (m) ({ data, json: dataJson } = await loaders.loadSerialized(m, { query: {} }));

        // Passing the localized URL pins router.locale (resolveLocale) and still
        // matches the locale-agnostic route table, so `t()` renders in `locale`.
        const { html, metadata, hydration } =
          (await mod.renderRoute(urlPath, params, "", { data })) ?? { html: "", metadata: {}, hydration: "" };
        const meta = i18nOn
          ? { ...metadata, links: [...(metadata.links || []), ...alternatesFor(path, locales, defaultLocale)] }
          : metadata;
        let head = mod.renderHead(meta, { path: urlPath, baseUrl });
        const preload = preloadFor(route);
        if (preload) head += `\n${preload}`;
        // SEO: expose the page's last-updated time (git/frontmatter) as Open Graph's
        // article:modified_time so crawlers see when the content actually changed.
        const iso = lastUpdated[path];
        if (iso) head += `\n<meta property="article:modified_time" content="${escapeXml(iso)}">`;
        const file = htmlPathFor(outDir, urlPath);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(
          file,
          injectRouteData(
            injectHydrationData(
              injectMarkup(injectHead(withHtmlLang(shellHtml, locale), head), html),
              hydration,
            ),
            dataJson,
          ),
        );
        if (m) {
          // The static data file SPA navigation fetches on a plain static host —
          // byte-identical to the inline payload ("null" when the loader returned
          // undefined, so a 200 still parses as JSON).
          const dataFile =
            urlPath === "/" ? join(outDir, DATA_FILE) : join(outDir, urlPath, DATA_FILE);
          mkdirSync(dirname(dataFile), { recursive: true });
          writeFileSync(dataFile, dataJson || "null");
        }
        rendered.push(urlPath);
      } catch (e) {
        failed.push(urlPath);
        const why = e?.otfwNotFound ? "loader called notFound()" : (e?.message ?? e);
        console.error(`✗ pre-render failed for ${urlPath}: ${why}`);
      }
    }
  }

  // 404: any unmatched path resolves to the registered 404 page. Mark noindex so
  // crawlers don't index the error page, and keep it out of the sitemap.
  try {
    const result = await mod.renderRoute("/__otfw_404__");
    if (result) {
      let head = mod.renderHead({ robots: "noindex", ...result.metadata }, { baseUrl });
      const preload = modulepreloadTags(chunkManifest?.notFound);
      if (preload) head += `\n${preload}`;
      writeFileSync(
        join(outDir, "404.html"),
        injectHydrationData(injectMarkup(injectHead(shellHtml, head), result.html), result.hydration),
      );
    }
  } catch {
    /* no 404 page */
  }

  // Crawl infrastructure: sitemap.xml + robots.txt (honoring public/ overrides).
  const publicDir = join(root, "public");
  const hasSitemap = writeSitemap(outDir, publicDir, baseUrl, rendered);
  writeRobots(outDir, publicDir, baseUrl, hasSitemap);

  cleanup();
  return { count: rendered.length, skipped, failed };
}
