// Shared plumbing for the SSG library (`@opentf/web-cli/ssg`): the pre-render
// driver that a site's `then: "run"` esdev target calls, plus the release-only
// output hook. esdev owns development, bundling and serving; this module keeps
// route discovery, the server render bundle, HTML shell injection and the docs
// output generators (search, feeds, LLM files) that run after a release build.

import { build } from "runtime:build";
import { dirname, join, toFileURL } from "runtime:path";
import { exit } from "runtime:process";

import { quiet } from "./reporter.js";

import { exists, findUp, mkdirp, readEntries, readText, resolveFrom, rmrf, writeFile } from "./runtime.js";

// The otfwc compiler service and the `runtime:build` transform plugin live in
// `@opentf/esdev-plugin-web`. Imported here for the server render bundle and
// re-exported so the SSG entry keeps a single import site.
import { closeCompilers, otfwPlugin, resolveCompiler } from "@opentf/esdev-plugin-web";

export { closeCompilers, resolveCompiler };

export const EXTENSIONS = [".jsx", ".tsx", ".js", ".ts", ".mdx", ".md"];

/** Inject `snippet` just before `</body>` (or append when there is none). */
export function injectBeforeBody(html, snippet) {
  // Function replacer so `$` in `snippet` is literal (String.replace treats `$1`,
  // `$&`, … in a string replacement as back-references — e.g. a "$189.00" price).
  return html.includes("</body>") ? html.replace("</body>", () => `${snippet}</body>`) : html + snippet;
}

/** Inject pre-rendered markup into the shell's empty `#app` container. */
export function injectMarkup(shellHtml, markup) {
  // Function replacer: `markup` may contain `$` (currency, etc.) — keep it literal.
  return shellHtml.replace(/(<div id="app"[^>]*>)\s*(<\/div>)/, (_m, open, close) => `${open}${markup}${close}`);
}

/**
 * Embed the island hydration payload (`renderRoute().hydration`) as a
 * `<script type="application/json" id="__otfw_h">` the client reads at upgrade so
 * components resume from rich JS props (compiler-driven data hydration). Placed before
 * `</body>`; a deferred module bundle runs after parse, so the payload is always in the
 * DOM first. `json` is already `<`-escaped by the server collector, so it can't break out
 * of the script. No-op for an empty payload. Uses a function replacer so `$` in the JSON
 * stays literal.
 */
export function injectHydrationData(shellHtml, json) {
  if (!json) return shellHtml;
  return injectBeforeBody(shellHtml, `<script type="application/json" id="__otfw_h">${json}</script>`);
}

/** The reserved per-route data filename/URL suffix (mirrors the runtime's
 *  `DATA_FILE` in `@opentf/web` runtime/route-data.js). */
export const DATA_FILE = "__data.json";

/**
 * Embed a route loader's data (docs/DATA.md) as a `<script type="application/json"
 * id="__otfw_data">` the client router reads on first paint (instead of fetching
 * `<path>/__data.json`). A separate script from the island payload above — the two
 * channels have independent shapes and readers. `json` comes `<`-escaped from
 * `serializeRouteData`; no-op for an empty payload (route without a loader, or an
 * undefined loader result).
 */
export function injectRouteData(shellHtml, json) {
  if (!json) return shellHtml;
  return injectBeforeBody(shellHtml, `<script type="application/json" id="__otfw_data">${json}</script>`);
}

/**
 * Stamp the `data-otfw-hydrate` sentinel onto the shell's `#app` container, telling
 * the client to *adopt* the server-rendered DOM on first paint instead of rebuilding
 * it (`runtime/router.js` `mountApp`). Used when the client bundle was built for the
 * hydrate target and there is server markup to adopt (SSR, and SSG pre-render).
 * Idempotent — a no-op if the sentinel is already present.
 */
export function stampHydrateSentinel(shellHtml) {
  return shellHtml.replace(/<div id="app"([^>]*)>/, (m, attrs) =>
    /\bdata-otfw-hydrate\b/.test(attrs) ? m : `<div id="app"${attrs} data-otfw-hydrate>`,
  );
}

/**
 * Inject per-route `<head>` tags before `</head>`, dropping the shell's default
 * `<title>` when the route supplies its own (so each page gets a unique,
 * non-duplicated title). Shared by SSG pre-render and the SSR server.
 */
export function injectHead(shellHtml, headHtml) {
  if (!headHtml) return shellHtml;
  let out = shellHtml;
  if (/<title[\s>]/i.test(headHtml)) out = out.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  // Function replacer so `$` in `headHtml` (e.g. a price in a meta description) is literal.
  return out.replace(/<\/head>/i, () => `${headHtml}\n</head>`);
}

/** Set/replace the shell's `<html lang>` for a localized page (i18n; docs/I18N.md §6). */
export function withHtmlLang(shellHtml, locale) {
  if (!locale) return shellHtml;
  if (/<html[^>]*\slang=/i.test(shellHtml)) {
    return shellHtml.replace(/(<html[^>]*\slang=)(["'])[^"']*\2/i, `$1$2${locale}$2`);
  }
  return shellHtml.replace(/<html\b/i, `<html lang="${locale}"`);
}

export { findUp };

/**
 * Load the optional project config (`otfw.config.{json,js,mjs}`) as a plain object.
 * Read by the build for the site URL (SEO) and the `docs` block (docs generator).
 */
export async function loadConfig(root) {
  const json = join(root, "otfw.config.json");
  if (await exists(json)) {
    try {
      return JSON.parse(await readText(json)) ?? {};
    } catch (e) {
      console.warn(`⚠ could not parse otfw.config.json: ${e?.message ?? e}`);
    }
  }
  for (const name of ["otfw.config.js", "otfw.config.mjs"]) {
    const p = join(root, name);
    if (await exists(p)) {
      try {
        const mod = await import(toFileURL(p).href);
        return mod.default ?? {};
      } catch (e) {
        console.warn(`⚠ could not load ${name}: ${e?.message ?? e}`);
      }
    }
  }
  return {};
}

/**
 * The docs navigation bundler plugin, when the project opts into the docs
 * generator (a `docs` block in otfw.config). Resolved from `@opentf/web-docs`
 * (the app's own dependency); returns null when docs aren't configured or the
 * package isn't installed, so the core toolchain stays untouched for normal apps.
 */
export async function loadDocsPlugins(root, appDir, config, exclude = new Set()) {
  const docs = config?.docs;
  const blog = config?.blog;
  if (!docs && !blog) return [];
  try {
    const entry = await resolveFrom("@opentf/web-docs/build", root);
    const { docsNavPlugin, blogPostsPlugin, lastUpdatedPlugin } = await import(toFileURL(entry).href);
    const plugins = [];
    // Resolves `@opentf/web-docs/nav` to a section map — one generated tree per top-level
    // folder under app/. Any folder with a DocsLayout becomes a section automatically.
    if (docs) plugins.push(docsNavPlugin({ appDir, exclude }));
    // Resolves `@opentf/web-docs/posts` to the generated post list.
    if (blog) plugins.push(blogPostsPlugin({ appDir, contentDir: blog.dir ?? "blog", exclude }));
    // Resolves `@opentf/web-docs/updated` to the per-page last-updated map (every route),
    // when last-updated is turned on anywhere.
    if (wantsLastUpdated(config)) plugins.push(lastUpdatedPlugin({ appDir, exclude }));
    return plugins;
  } catch (e) {
    console.warn(
      `⚠ docs/blog config present but @opentf/web-docs could not be loaded: ${e?.message ?? e}`,
    );
    return [];
  }
}

/** Whether "last updated" tracking is enabled anywhere (`docs`/`blog` `lastUpdated`). */
export function wantsLastUpdated(config) {
  return Boolean(config?.docs?.lastUpdated || config?.blog?.lastUpdated);
}

/**
 * Build the `{ [routePath]: ISO }` last-updated map for every page (the same map the
 * `@opentf/web-docs/updated` virtual module exposes). Used by the SSG step to emit
 * `article:modified_time`. Returns `{}` when last-updated is off or the package can't
 * be loaded.
 */
export async function runLastUpdated(root, appDir, config, exclude = new Set()) {
  if (!wantsLastUpdated(config)) return {};
  try {
    const entry = await resolveFrom("@opentf/web-docs/build", root);
    const { loadLastUpdated } = await import(toFileURL(entry).href);
    return await loadLastUpdated({ appDir, exclude });
  } catch (e) {
    console.warn(`⚠ last-updated map skipped: ${e?.message ?? e}`);
    return {};
  }
}

/** Index the completed SSG output when static search is enabled. Errors fail the build. */
export async function runDocsSearchIndex(root, config, siteDir, otfwc) {
  if (config?.docs?.search?.provider !== "otf") return null;
  const entry = await resolveFrom("@opentf/web-docs/build", root);
  const { indexWithOtfSearch } = await import(toFileURL(entry).href);
  return indexWithOtfSearch({ siteDir, otfwc });
}

/**
 * Generate blog feeds when the project has a `blog` config and a base URL. Scans the
 * post folders, renders RSS 2.0 + Atom 1.0, and writes them under
 * `<siteDir>/<blogDir>/`. Project-supplied `public/<blogDir>/{rss,atom}.xml` files
 * take precedence independently. Returns `{ paths, urls, count }` or null (no blog /
 * no base URL / all feeds overridden / package missing). Resolved from the app's
 * `@opentf/web-docs`.
 */
export async function runBlogFeed(root, appDir, config, siteDir, baseUrl, exclude = new Set()) {
  const blog = config?.blog;
  if (!blog) return null;
  if (!baseUrl) {
    console.warn("⚠ blog feeds skipped: no site URL (pass --base-url or set otfw.config)");
    return null;
  }
  const contentDir = blog.dir ?? "blog";
  try {
    const entry = await resolveFrom("@opentf/web-docs/build", root);
    const { loadPosts, renderAtomFeed, renderBlogFeed } = await import(toFileURL(entry).href);
    const posts = await loadPosts({ appDir, contentDir, exclude });
    const title = blog.title || (config?.docs?.title ? `${config.docs.title} Blog` : "Blog");
    const channel = {
      title,
      description: blog.description || title,
      link: `/${contentDir}`,
    };
    const feeds = [
      {
        file: "rss.xml",
        path: `/${contentDir}/rss.xml`,
        render: renderBlogFeed,
      },
      {
        file: "atom.xml",
        path: `/${contentDir}/atom.xml`,
        render: renderAtomFeed,
      },
    ];
    const written = [];
    for (const feed of feeds) {
      if (await exists(join(root, "public", contentDir, feed.file))) continue; // honor override
      const out = join(siteDir, contentDir, feed.file);
      await writeFile(out, feed.render({ posts, baseUrl, feedPath: feed.path, channel }));
      written.push(feed.path);
    }
    if (!written.length) return null;
    const origin = baseUrl.replace(/\/+$/, "");
    return { paths: written, urls: written.map((path) => origin + path), count: posts.length };
  } catch (e) {
    console.warn(`⚠ blog feeds skipped: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Generate `/llms.txt` and `/llms-full.txt` for docs/blog sites from the same
 * filesystem route list used by the app build. Project-supplied public files override
 * each output independently. `siteDescription` is the site's own description (resolved
 * from the app's metadata during the build) — llms.txt summarizes the site with it
 * rather than with a generic line.
 */
export async function runLlmsFiles(root, appDir, pages, config, siteDir, baseUrl, { siteDescription = "" } = {}) {
  if (!config?.docs && !config?.blog) return null;
  const candidates = [
    { file: "llms.txt", render: "renderLlmsTxt" },
    { file: "llms-full.txt", render: "renderLlmsFullTxt" },
  ];
  const outputs = [];
  for (const out of candidates) {
    if (!(await exists(join(root, "public", out.file)))) outputs.push(out);
  }
  if (!outputs.length) return null;

  try {
    const entry = await resolveFrom("@opentf/web-docs/build", root);
    const mod = await import(toFileURL(entry).href);
    const written = [];
    for (const out of outputs) {
      const render = mod[out.render];
      if (typeof render !== "function") continue;
      await writeFile(join(siteDir, out.file), await render({ appDir, pages, baseUrl, config, siteDescription }));
      written.push(`/${out.file}`);
    }
    return written.length ? { paths: written } : null;
  } catch (e) {
    console.warn(`⚠ llms.txt skipped: ${e?.message ?? e}`);
    return null;
  }
}

/** Discover file-based routes under `app/`: every page/layout and the 404. */
export async function discoverPages(dir, exclude) {
  const out = [];
  for (const entry of await readEntries(dir)) {
    if (entry.isDir && exclude.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDir) out.push(...(await discoverPages(full, exclude)));
    else if (/^404\.(mdx|md)$/.test(entry.name)) {
      throw new Error(`Unsupported Markdown 404 route: ${full}. Use 404.jsx or 404.tsx instead.`);
    }
    else if (/^(page|layout|404)\.(mdx|md|[jt]sx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Discover file-based API routes anywhere under `app/` (SPEC §11). An endpoint is a
 * `route.{js,ts}` file (the API analogue of `page.{jsx,tsx}`); its folder is the URL.
 * Returns `{ routes, middleware }` — absolute paths to `route.*` handler modules and
 * to `_middleware.{js,ts}` files (folder middleware) respectively.
 */
export async function discoverApiRoutes(appDir, exclude = new Set()) {
  const routes = [];
  const middleware = [];
  const walk = async (dir) => {
    for (const entry of await readEntries(dir)) {
      if (entry.isDir) {
        if (!exclude.has(entry.name)) await walk(join(dir, entry.name));
        continue;
      }
      const name = entry.name;
      const full = join(dir, name);
      if (/^route\.(jsx?|tsx?)$/.test(name)) routes.push(full);
      else if (/^_middleware\.(jsx?|tsx?)$/.test(name)) middleware.push(full);
    }
  };
  await walk(appDir);
  return { routes, middleware };
}

/**
 * Strip the app-directory prefix from a route file path. With `appDir` the exact
 * prefix is removed (unambiguous even for `app/app/...`); without it, fall back to
 * the last complete `/app` path segment — the lookahead keeps folders that merely
 * start with "app" (`/appointments`) intact.
 */
function stripAppPrefix(filePath, appDir) {
  if (appDir) {
    const base = appDir.replace(/\/+$/, "");
    if (filePath.startsWith(base + "/")) return filePath.slice(base.length);
  }
  return filePath.replace(/^.*\/app(?=\/)/, "");
}

/** `<link rel="modulepreload">` tags for a route's chunk hrefs (`""` when there are none). */
export function modulepreloadTags(hrefs) {
  if (!hrefs || hrefs.length === 0) return "";
  return hrefs.map((h) => `<link rel="modulepreload" href="${h}">`).join("\n");
}

/** The page URL for a `.../app/<...>/page.{mdx,md,jsx,tsx}` file (folder = URL). */
export function pageRouteFromPath(filePath, appDir) {
  const r = stripAppPrefix(filePath, appDir).replace(/\/page\.(mdx|md|jsx|tsx)$/, "");
  return r === "" ? "/" : r;
}

/** The route URL for a `.../app/<...>/route.{js,ts}` file (folder = URL). */
function apiRoutePath(filePath, appDir) {
  const r = stripAppPrefix(filePath, appDir).replace(/\/route\.(jsx?|tsx?)$/, "");
  return r === "" ? "/" : r;
}

/**
 * Discover route loaders anywhere under `app/` (docs/DATA.md). A loader is a
 * `loader.{js,ts}` file sibling to a `page.*` — the data analogue of a `route.*`
 * endpoint. Strictly `js|ts` (no `x` variants): loaders are plain server modules,
 * never JSX. Returns absolute file paths.
 */
export async function discoverLoaders(appDir, exclude = new Set()) {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readEntries(dir)) {
      if (entry.isDir) {
        if (!exclude.has(entry.name)) await walk(join(dir, entry.name));
      } else if (/^loader\.(js|ts)$/.test(entry.name)) out.push(join(dir, entry.name));
    }
  };
  await walk(appDir);
  return out;
}

/** The page route a `.../app/<...>/loader.{js,ts}` file feeds (folder = URL). */
export function loaderRoutePath(filePath, appDir) {
  const r = stripAppPrefix(filePath, appDir).replace(/\/loader\.(js|ts)$/, "");
  return r === "" ? "/" : r;
}

/**
 * Detect folders that hold both a `page.*` and a `route.*` — they'd resolve to the
 * same URL. Returns the conflicting `{ path, page, route }` entries (empty = none).
 * A page and an endpoint cannot own the same path (as in Next.js's App Router).
 */
export async function detectRouteConflicts(appDir, exclude = new Set()) {
  const pageByRoute = new Map();
  for (const p of await discoverPages(appDir, exclude)) {
    if (/\/page\.(mdx|md|jsx|tsx)$/.test(p)) pageByRoute.set(pageRouteFromPath(p, appDir), p);
  }
  const conflicts = [];
  for (const r of (await discoverApiRoutes(appDir, exclude)).routes) {
    const path = apiRoutePath(r, appDir);
    if (pageByRoute.has(path)) conflicts.push({ path, page: pageByRoute.get(path), route: r });
  }
  return conflicts;
}

/**
 * Detect misplaced `loader.*` files (docs/DATA.md): a loader feeds the page in
 * its folder, so one without a sibling `page.*` — including one placed next to a
 * `route.*` endpoint — has nothing to feed. Returns `{ loader, route, reason }`.
 */
export async function detectLoaderConflicts(appDir, exclude = new Set()) {
  const conflicts = [];
  const anyExists = async (dir, names) => {
    for (const n of names) if (await exists(join(dir, n))) return true;
    return false;
  };
  for (const loader of await discoverLoaders(appDir, exclude)) {
    const dir = dirname(loader);
    if (await anyExists(dir, ["page.jsx", "page.tsx", "page.mdx", "page.md"])) continue;
    const hasRoute = await anyExists(dir, ["route.js", "route.ts"]);
    conflicts.push({
      loader,
      route: loaderRoutePath(loader, appDir),
      reason: hasRoute
        ? "sits next to a route.* API endpoint (endpoints take a Request; loaders feed pages)"
        : "has no sibling page.* to feed",
    });
  }
  return conflicts;
}

/** Print the route/page/loader conflicts and exit the prerender step. */
export async function assertNoRouteConflicts(appDir, exclude = new Set()) {
  const conflicts = await detectRouteConflicts(appDir, exclude);
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => `  ${c.path}\n    page:  ${c.page}\n    route: ${c.route}`).join("\n");
    fail(`a page and an API route cannot resolve to the same path:\n${lines}\n  Move one to a different folder.`);
  }
  const loaderConflicts = await detectLoaderConflicts(appDir, exclude);
  if (loaderConflicts.length > 0) {
    const lines = loaderConflicts.map((c) => `  ${c.route}\n    loader: ${c.loader}\n    ${c.reason}`).join("\n");
    fail(`a loader.* file must sit next to the page.* it feeds:\n${lines}`);
  }
}

/**
 * Entry source for the API/middleware server bundle: statically import every
 * route + middleware module (keyed by absolute path so scopes/routes derive from
 * the path), then export three composed handlers. Mirrors `serverEntrySource`
 * for the page/SSG bundle.
 *
 *   apiHandler  — routes with the API-scoped middleware composed in (standalone /
 *                 legacy adapter use, where nothing else runs the middleware);
 *   apiRoutes   — routes only, for servers that run `middleware` themselves at
 *                 pipeline level — middleware must not run twice;
 *   middleware  — the `createMiddleware` runner governing the whole request
 *                 pipeline (pages, endpoints, loader data — docs/MIDDLEWARE.md).
 */
export function apiEntrySource({ routes, middleware }, appDir, i18n = null) {
  const rImports = routes.map((p, i) => `import * as r${i} from ${JSON.stringify(p)};`).join("\n");
  const mImports = middleware.map((p, i) => `import * as m${i} from ${JSON.stringify(p)};`).join("\n");
  const rMap = routes.map((p, i) => `  [${JSON.stringify(p)}]: r${i},`).join("\n");
  const mMap = middleware.map((p, i) => `  [${JSON.stringify(p)}]: m${i},`).join("\n");
  // `appDir` pins the exact prefix to strip from the keys — route derivation stays
  // correct for folders whose name starts with "app" and for nested app/app dirs.
  // `i18n` lets middleware scope matching strip a non-default locale prefix.
  const i18nOpt =
    i18n && Array.isArray(i18n.locales) && i18n.locales.length
      ? `, i18n: ${JSON.stringify({ locales: i18n.locales, defaultLocale: i18n.defaultLocale })}`
      : "";
  const opts = appDir ? `{ appDir: ${JSON.stringify(appDir)}${i18nOpt} }` : `{${i18nOpt.replace(/^,\s*/, " ")} }`;
  return (
    `import { createApiHandler, createMiddleware } from "@opentf/web/server";\n` +
    `${rImports}\n${mImports}\n` +
    `const routeModules = {\n${rMap}\n};\n` +
    `const middlewareModules = {\n${mMap}\n};\n` +
    `export const apiHandler = createApiHandler(routeModules, middlewareModules, ${opts});\n` +
    `export const apiRoutes = createApiHandler(routeModules, {}, ${opts});\n` +
    `export const middleware = createMiddleware(middlewareModules, ${opts});\n`
  );
}

/**
 * Emit the API handler bundle to `outDir/api.js` for production/deploy (SPEC §13,
 * `dist/server/`). This writes a persistent, self-contained ESM module that
 * exports `apiHandler` / `apiRoutes` / `middleware` (see `apiEntrySource`) — the
 * runtime dispatchers are bundled in; npm/node deps stay external and resolve at
 * the deploy target. A deploy adapter (`server/adapters/`) imports this file and
 * hands requests to the handlers. Returns `{ routes, middleware }`, or `null`
 * when the project has neither API routes nor middleware.
 */
export async function emitApiBundle({ root, appDir, webEntry, exclude, i18n, outDir }) {
  const discovered = await discoverApiRoutes(appDir, exclude);
  if (discovered.routes.length === 0 && discovered.middleware.length === 0) return null;

  const tmp = join(root, ".otfw-api-build");
  await mkdirp(tmp);
  const entry = join(tmp, "api-entry.js");
  await writeFile(entry, apiEntrySource(discovered, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  await mkdirp(outDir);
  const bundle = await build({
    input: entry,
    platform: "node",
    resolve: { alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry }, extensions: EXTENSIONS },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
  });
  try {
    await bundle.write({ dir: outDir, format: "esm", entryFileNames: "api.js" });
  } finally {
    await bundle.close();
  }
  await rmrf(tmp);
  return { routes: discovered.routes, middleware: discovered.middleware };
}

/**
 * Entry source for the loader bundle (docs/DATA.md): statically import every
 * `loader.{js,ts}` module (keyed by absolute path so the registry derives each
 * route from it) and export the composed registry. Mirrors `apiEntrySource`.
 */
export function loaderEntrySource(loaderFiles, appDir, i18n = null) {
  const imports = loaderFiles.map((p, i) => `import * as l${i} from ${JSON.stringify(p)};`).join("\n");
  const map = loaderFiles.map((p, i) => `  [${JSON.stringify(p)}]: l${i},`).join("\n");
  const i18nOpt =
    i18n && Array.isArray(i18n.locales) && i18n.locales.length
      ? `, i18n: ${JSON.stringify({ locales: i18n.locales, defaultLocale: i18n.defaultLocale })}`
      : "";
  const opts = `\n{ appDir: ${JSON.stringify(appDir ?? "")}${i18nOpt} },\n`;
  return (
    `import { createLoaderRegistry } from "@opentf/web/server";\n` +
    `${imports}\n` +
    `export const loaders = createLoaderRegistry(\n{\n${map}\n},${opts});\n`
  );
}

/**
 * Emit the loader bundle to `outDir/loaders.js` for production (`dist/server/`,
 * next to `api.js`). The prerender runs these loaders at build time; a deploy
 * server can import the same file to serve `<path>/__data.json`. Returns `{ files }`, or `null` when
 * the app has no loader files.
 */
export async function emitLoaderBundle({ root, appDir, webEntry, exclude, i18n, outDir }) {
  const files = await discoverLoaders(appDir, exclude);
  if (files.length === 0) return null;

  const tmp = join(root, ".otfw-loaders-build");
  await mkdirp(tmp);
  const entry = join(tmp, "loaders-entry.js");
  await writeFile(entry, loaderEntrySource(files, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  await mkdirp(outDir);
  const bundle = await build({
    input: entry,
    platform: "node",
    resolve: { alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry }, extensions: EXTENSIONS },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
  });
  try {
    await bundle.write({ dir: outDir, format: "esm", entryFileNames: "loaders.js" });
  } finally {
    await bundle.close();
  }
  await rmrf(tmp);
  return { files };
}

/**
 * CSS plugin: `import "./x.css"` injects a <style>; `*.module.css` resolves to an
 * identity class-name map (`styles.foo` → "foo"). Dev-grade CSS Modules.
 */
export function cssPlugin() {
  return {
    name: "css",
    transform: {
      filter: { id: /\.css$/ },
      // `pre` so this claims a stylesheet before the runtime's own CSS Modules pass
      // does: that pass resolves `@import` for real, and an app stylesheet's
      // `@import "tailwindcss"` is a directive for Tailwind, not a module to fetch.
      order: "pre",
      handler(code, id) {
        const inject =
          `const __s = document.createElement("style");` +
          ` __s.textContent = ${JSON.stringify(code)};` +
          ` document.head.appendChild(__s);`;
        const out = id.endsWith(".module.css")
          ? `${inject}\nexport default new Proxy({}, { get: (_, k) => k });`
          : `${inject}\nexport default ${JSON.stringify(code)};`;
        return { code: out, type: "js", moduleSideEffects: true };
      },
    },
  };
}

// Generated server entry: eager-import every page module (so `registerRoutes`
// sees real namespaces, enabling `getStaticPaths`) and re-export the render API.
// Shared by the SSG pre-render and the SSR server — both render through the same
// SSG-compiled bundle (ARCHITECTURE.md §6: "SSR … shares the SSG path").
export function serverEntrySource(pages, i18n = null) {
  const imports = pages.map((p, i) => `import * as p${i} from ${JSON.stringify(p)};`).join("\n");
  const map = pages.map((p, i) => `  [${JSON.stringify(p)}]: p${i},`).join("\n");
  // i18n: the server-side router needs the locales too — so renderRoute can strip
  // a `/fr/...` prefix to match the route table and set router.locale for `t()`
  // (docs/I18N.md §6). Without this the prefix wouldn't match and pages would
  // render in the default locale (or 404).
  const i18nOn = i18n && Array.isArray(i18n.locales) && i18n.locales.length;
  const named = i18nOn ? "registerRoutes, configureI18n" : "registerRoutes";
  const i18nCall = i18nOn
    ? `configureI18n(${JSON.stringify({ locales: i18n.locales, defaultLocale: i18n.defaultLocale })});\n`
    : "";
  return (
    `${imports}\n` +
    `import { ${named} } from "@opentf/web/server";\n` +
    `export { renderRoute, renderHead, collectRoutePaths, resolveMetadata } from "@opentf/web/server";\n` +
    i18nCall +
    `registerRoutes({\n${map}\n});\n`
  );
}

/**
 * Build the server render bundle (the compiler's SSG backend — HTML-string
 * renderers) and import it. Returns `{ mod, cleanup }`, where `mod` exposes
 * `renderRoute` / `renderHead` / `collectRoutePaths` and `cleanup()` removes the
 * temp build dir. The SSG pre-render calls `cleanup()` immediately after rendering
 * every route; the SSR server keeps the module live and cleans up on shutdown.
 */
export async function buildServerBundle({
  root,
  pages,
  webEntry,
  otfwc,
  docsPlugins = [],
  i18n = null,
  onCompile,
  tmpName = ".otfw-ssg",
}) {
  const tmp = join(root, tmpName);
  await mkdirp(tmp);
  const entry = join(tmp, "ssg-entry.js");
  await writeFile(entry, serverEntrySource(pages, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  const bundle = await build({
    input: entry,
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    // The runtime guards its dev diagnostics on `process.env.NODE_ENV`, and there is
    // no `process` global here to read it at runtime — so it has to be folded away at
    // bundle time. Server render is a production render.
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      ...docsPlugins,
      otfwPlugin(otfwc, { failOnError: true, target: "ssg", quiet, onResult: (id) => onCompile?.(id) }),
      cssPlugin(),
    ],
  });
  try {
    await bundle.write({ dir: join(tmp, "out"), format: "esm", entryFileNames: "server.js" });
  } finally {
    await bundle.close();
  }

  // The runtime defines `class … extends HTMLElement` at load (for CSR custom
  // elements). Server render never instantiates them, but the base class must
  // exist so the class definitions evaluate. A bare stub suffices — no DOM
  // (customElements stays undefined, so elements self-register only in the browser).
  globalThis.HTMLElement ??= class {};
  const mod = await import(toFileURL(join(tmp, "out", "server.js")).href);
  return { mod, cleanup: () => rmrf(tmp) };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  exit(1);
}
