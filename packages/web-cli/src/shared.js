// Shared plumbing for the OTF Web toolchain (`otfw dev` / `otfw build`).
//
// Both commands treat the current working directory as the project root (its
// `index.html` + `app/`), resolve `@opentf/web` via node resolution, run the
// `otfwc` IR compiler as a Rolldown `transform` plugin, and let Rolldown link the
// module graph. This module holds everything they have in common.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "rolldown";

import { otfwcPath } from "@opentf/web-compiler";

export const EXTENSIONS = [".jsx", ".tsx", ".js", ".ts", ".mdx", ".md"];

export const MIME = {
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

/** Fallback HTML shell used when a project has no `index.html`. */
export const DEFAULT_HTML_SHELL =
  `<!doctype html><html lang="en"><head>\n` +
  `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<title>OTF Web</title></head><body><div id="app"></div></body></html>`;

// The project's own module entry <script> is stripped so the toolchain injects
// its own bundle in its place.
const MODULE_ENTRY_RE = /<script\s+type=["']module["'][^>]*src=[^>]*>\s*<\/script>\s*/gi;

/**
 * The project's `index.html` shell (or {@link DEFAULT_HTML_SHELL}) with the app's
 * module entry script removed — the common starting point for `dev` and `build`.
 */
export function readHtmlShell(root) {
  const indexPath = join(root, "index.html");
  const html = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : DEFAULT_HTML_SHELL;
  return html.replace(MODULE_ENTRY_RE, "");
}

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

/** Nearest ancestor directory of `from` (inclusive) that contains `name`. */
export function findUp(name, from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function hasLocalCompilerWorkspace(workspace) {
  return !!workspace && existsSync(join(workspace, "crates", "otfw_cli", "Cargo.toml"));
}

export function resolveCompiler({
  cliDir = dirname(fileURLToPath(import.meta.url)),
  env = process.env,
  resolvePackagedCompiler = otfwcPath,
  findWorkspace = findUp,
  ensure = ensureCompiler,
} = {}) {
  if (env.OTFWC_BIN) return { otfwc: env.OTFWC_BIN, workspace: null };

  let packagedError = null;
  try {
    return { otfwc: resolvePackagedCompiler(), workspace: null };
  } catch (e) {
    packagedError = e;
  }

  const installedPackage = cliDir.split(/[\\/]/).includes("node_modules");
  const workspace = installedPackage ? null : findWorkspace("Cargo.toml", cliDir);
  if (hasLocalCompilerWorkspace(workspace)) {
    const otfwc = join(workspace, "target", "debug", "otfwc");
    ensure(otfwc, workspace);
    return { otfwc, workspace };
  }

  fail(
    `${packagedError?.message ?? "cannot resolve @opentf/web-compiler prebuilt binary"}\n` +
      `  No local otfwc compiler workspace was found to build from source.`,
  );
}

/**
 * Resolve the project and toolchain: the app being built (cwd), the runtime
 * package, the `otfwc` compiler, and the excluded routes. Exits with a clear
 * message on any hard failure. Source checkouts can build the compiler on demand
 * from this repo's Cargo workspace; published installs use @opentf/web-compiler.
 */
export function loadProject() {
  const root = process.cwd();

  const appDir = join(root, "app");
  if (!existsSync(appDir)) {
    fail(
      `no app/ directory in ${root}\n  run otfw from your project root (the folder with index.html and app/).`,
    );
  }

  // Resolve the runtime the way the bundler will, so it works as an installed
  // dependency or a workspace package — no hardcoded path.
  let webEntry;
  try {
    webEntry = Bun.resolveSync("@opentf/web", root);
  } catch {
    fail(`cannot resolve "@opentf/web" from ${root}\n  add it to your dependencies.`);
  }

  // Locate the `otfwc` compiler. Explicit overrides win, then the packaged
  // compiler binary, then this repo's local Rust workspace as a source fallback.
  const { otfwc, workspace } = resolveCompiler();

  // Route directories to skip during discovery — comma-separated names in
  // EXCLUDE_ROUTES. None are excluded by default.
  const exclude = new Set(
    (process.env.EXCLUDE_ROUTES ?? "").split(",").filter(Boolean),
  );

  return { root, appDir, webEntry, otfwc, workspace, exclude };
}

function ensureCompiler(otfwc, workspace) {
  if (existsSync(otfwc)) return;
  if (!workspace) fail(`otfwc compiler not found at ${otfwc}`);
  console.log("building compiler (cargo build -p otfw_cli)…");
  const cargo = Bun.spawnSync(["cargo", "--version"], {
    cwd: workspace,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (cargo.error || cargo.exitCode !== 0) {
    fail(
      `cannot build otfwc because cargo is not available.\n` +
        `  This source checkout needs Rust/Cargo to build ${otfwc}.\n` +
        `  Install Rust in the build environment, set OTFWC_BIN to an existing otfwc binary,\n` +
        `  or build with the published @opentf/web-cli package so @opentf/web-compiler can use its prebuilt binary.`,
    );
  }
  const b = Bun.spawnSync(["cargo", "build", "-p", "otfw_cli"], {
    cwd: workspace,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (b.exitCode !== 0) process.exit(b.exitCode);
}

/**
 * Load the optional project config (`otfw.config.{json,js,mjs}`) as a plain object.
 * Read by the build for the site URL (SEO) and the `docs` block (docs generator).
 */
export async function loadConfig(root) {
  const json = join(root, "otfw.config.json");
  if (existsSync(json)) {
    try {
      return JSON.parse(readFileSync(json, "utf8")) ?? {};
    } catch (e) {
      console.warn(`⚠ could not parse otfw.config.json: ${e?.message ?? e}`);
    }
  }
  for (const name of ["otfw.config.js", "otfw.config.mjs"]) {
    const p = join(root, name);
    if (existsSync(p)) {
      try {
        return (await import(pathToFileURL(p).href)).default ?? {};
      } catch (e) {
        console.warn(`⚠ could not load ${name}: ${e?.message ?? e}`);
      }
    }
  }
  return {};
}

/**
 * Normalize the optional `proxy` config into an ordered rule list. In dev, matched
 * paths are forwarded to a target origin instead of being handled in-process — the
 * provider-agnostic escape hatch for backends the dev server can't host itself
 * (e.g. Cloudflare bindings like D1, which only exist inside `wrangler dev`). Config:
 *
 *   // otfw.config.js — forward /api/* to a locally running worker
 *   export default { proxy: { "/api": "http://localhost:8787" } };
 *
 * The value is a target origin string, or `{ target }`. Rules are sorted
 * longest-prefix-first so the most specific mapping wins.
 */
export function resolveProxyRules(config) {
  const proxy = config?.proxy;
  if (!proxy || typeof proxy !== "object") return [];
  const rules = [];
  for (const [prefix, value] of Object.entries(proxy)) {
    const target = typeof value === "string" ? value : value?.target;
    if (!target) continue;
    rules.push({
      prefix: prefix.replace(/\/+$/, "") || "/",
      target: String(target).replace(/\/+$/, ""),
    });
  }
  rules.sort((a, b) => b.prefix.length - a.prefix.length);
  return rules;
}

/** The proxy target for a pathname, or `null` if no rule matches. A rule matches
 *  its exact prefix path or anything nested under it (`/api` → `/api`, `/api/x`). */
export function matchProxyTarget(pathname, rules) {
  for (const r of rules) {
    if (r.prefix === "/" || pathname === r.prefix || pathname.startsWith(r.prefix + "/")) {
      return r.target;
    }
  }
  return null;
}

/**
 * Forward a request to a proxy `target` origin, preserving path, query, method,
 * headers, and body. Used by `otfw dev` to bridge to a separately-running backend
 * (e.g. `wrangler dev`). A connection failure becomes a 502 with a hint rather than
 * crashing the dev server.
 */
export function proxyRequest(req, target) {
  const url = new URL(req.url);
  const dest = new URL(url.pathname + url.search, target);
  const headers = new Headers(req.headers);
  headers.delete("host"); // let fetch set the upstream Host from `dest`
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return fetch(dest, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {}),
  }).then(
    (res) => {
      // fetch has already decompressed the body, but the upstream's
      // Content-Encoding/Content-Length headers still describe the compressed
      // bytes. Relaying them verbatim makes the browser decode the plain body
      // a second time (ERR_CONTENT_DECODING_FAILED), so strip them.
      if (!res.headers.has("content-encoding")) return res;
      const h = new Headers(res.headers);
      h.delete("content-encoding");
      h.delete("content-length");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    },
    (e) =>
      new Response(
        `Bad Gateway: dev proxy could not reach ${target}\n` +
          `Is the upstream running? (e.g. \`wrangler dev\`)\n\n${e?.message ?? e}`,
        { status: 502, headers: { "content-type": "text/plain" } },
      ),
  );
}

/**
 * The docs navigation Rolldown plugin, when the project opts into the docs
 * generator (a `docs` block in otfw.config). Resolved from `@opentf/web-docs`
 * (the app's own dependency); returns null when docs aren't configured or the
 * package isn't installed, so the core toolchain stays untouched for normal apps.
 */
export async function loadDocsPlugins(root, appDir, config, exclude = new Set()) {
  const docs = config?.docs;
  const blog = config?.blog;
  if (!docs && !blog) return [];
  try {
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const { docsNavPlugin, blogPostsPlugin, lastUpdatedPlugin } = await import(
      pathToFileURL(entry).href
    );
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
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const { loadLastUpdated } = await import(pathToFileURL(entry).href);
    return loadLastUpdated({ appDir, exclude });
  } catch (e) {
    console.warn(`⚠ last-updated map skipped: ${e?.message ?? e}`);
    return {};
  }
}

/**
 * Run Pagefind over the built site when the docs config opts into it
 * (`docs.search.provider === "pagefind"`). Indexes the pre-rendered HTML in `siteDir`
 * and writes `<siteDir>/pagefind/`. No-op (returns null) otherwise. Resolved from the
 * app's `@opentf/web-docs` so the hook ships with the docs package.
 */
export async function runDocsSearchIndex(root, config, siteDir, onProgress) {
  if (config?.docs?.search?.provider !== "pagefind") return null;
  try {
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const { indexWithPagefind } = await import(pathToFileURL(entry).href);
    return await indexWithPagefind({ siteDir, onProgress });
  } catch (e) {
    console.warn(`⚠ Pagefind indexing skipped: ${e?.message ?? e}`);
    return null;
  }
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
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const { loadPosts, renderAtomFeed, renderBlogFeed } = await import(pathToFileURL(entry).href);
    const posts = loadPosts({ appDir, contentDir, exclude });
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
      if (existsSync(join(root, "public", contentDir, feed.file))) continue; // honor override
      const out = join(siteDir, contentDir, feed.file);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, feed.render({ posts, baseUrl, feedPath: feed.path, channel }));
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
 * each output independently.
 */
export async function runLlmsFiles(root, appDir, pages, config, siteDir, baseUrl) {
  if (!config?.docs && !config?.blog) return null;
  const outputs = [
    { file: "llms.txt", render: "renderLlmsTxt" },
    { file: "llms-full.txt", render: "renderLlmsFullTxt" },
  ].filter((out) => !existsSync(join(root, "public", out.file)));
  if (!outputs.length) return null;

  try {
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const mod = await import(pathToFileURL(entry).href);
    const written = [];
    for (const out of outputs) {
      const render = mod[out.render];
      if (typeof render !== "function") continue;
      writeFileSync(join(siteDir, out.file), render({ appDir, pages, baseUrl, config }));
      written.push(`/${out.file}`);
    }
    return written.length ? { paths: written } : null;
  } catch (e) {
    console.warn(`⚠ llms.txt skipped: ${e?.message ?? e}`);
    return null;
  }
}

/** Discover file-based routes under `app/`: every page/layout and the 404. */
export function discoverPages(dir, exclude) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && exclude.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...discoverPages(full, exclude));
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
export function discoverApiRoutes(appDir, exclude = new Set()) {
  const routes = [];
  const middleware = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      const name = entry.name;
      const full = join(dir, name);
      if (/^route\.(jsx?|tsx?)$/.test(name)) routes.push(full);
      else if (/^_middleware\.(jsx?|tsx?)$/.test(name)) middleware.push(full);
    }
  };
  walk(appDir);
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
export function discoverLoaders(appDir, exclude = new Set()) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name)) walk(join(dir, entry.name));
      } else if (/^loader\.(js|ts)$/.test(entry.name)) out.push(join(dir, entry.name));
    }
  };
  walk(appDir);
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
export function detectRouteConflicts(appDir, exclude = new Set()) {
  const pageByRoute = new Map();
  for (const p of discoverPages(appDir, exclude)) {
    if (/\/page\.(mdx|md|jsx|tsx)$/.test(p)) pageByRoute.set(pageRouteFromPath(p, appDir), p);
  }
  const conflicts = [];
  for (const r of discoverApiRoutes(appDir, exclude).routes) {
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
export function detectLoaderConflicts(appDir, exclude = new Set()) {
  const conflicts = [];
  for (const loader of discoverLoaders(appDir, exclude)) {
    const dir = dirname(loader);
    const hasPage = ["page.jsx", "page.tsx", "page.mdx", "page.md"].some((f) => existsSync(join(dir, f)));
    if (hasPage) continue;
    const hasRoute = ["route.js", "route.ts"].some((f) => existsSync(join(dir, f)));
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

/** Print the route/page/loader conflicts and exit — shared by build, dev, and serve. */
export function assertNoRouteConflicts(appDir, exclude = new Set()) {
  const conflicts = detectRouteConflicts(appDir, exclude);
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => `  ${c.path}\n    page:  ${c.page}\n    route: ${c.route}`).join("\n");
    fail(`a page and an API route cannot resolve to the same path:\n${lines}\n  Move one to a different folder.`);
  }
  const loaderConflicts = detectLoaderConflicts(appDir, exclude);
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
 *                 pipeline level (dev/serve) — middleware must not run twice;
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
 * Build the API handler bundle and import it. Returns `{ handler, cleanup }`
 * where `handler(request)` resolves to a `Response` or `null` (no API route
 * matched). Route modules are *plain server code* — bundled as ESM without the
 * `otfwc` DOM transform. Bare (npm / node builtin) imports stay external and are
 * resolved at runtime from the project's node_modules, so server deps and native
 * modules aren't dragged into the bundle. Returns `null` when there are no routes
 * and no middleware (a middleware-only app still needs the bundle for its pages).
 */
export async function buildApiBundle({ root, appDir, webEntry, exclude, i18n, tmpName = ".otfw-api", bust }) {
  const discovered = discoverApiRoutes(appDir, exclude);
  if (discovered.routes.length === 0 && discovered.middleware.length === 0) return null;

  const tmp = join(root, tmpName);
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "api-entry.js");
  writeFileSync(entry, apiEntrySource(discovered, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  // `bust` versions the emitted *filename* so `otfw dev` picks up handler edits on
  // rebuild — Bun's ESM cache is keyed by file path and ignores a `?v=` query, so
  // only a genuinely new path re-evaluates the module.
  const outName = bust ? `api.${bust}.js` : "api.js";
  await build({
    input: entry,
    platform: "node",
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    // Keep npm/node builtins external — server handlers resolve them at runtime.
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
    output: { dir: join(tmp, "out"), format: "esm", entryFileNames: outName },
    checks: { pluginTimings: false },
  });

  const mod = await import(pathToFileURL(join(tmp, "out", outName)).href);
  return {
    handler: mod.apiHandler,
    apiRoutes: mod.apiRoutes,
    middleware: mod.middleware,
    routes: discovered.routes,
    middlewareFiles: discovered.middleware,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

/**
 * Emit the API handler bundle to `outDir/api.js` for production/deploy (SPEC §13,
 * `dist/server/`). Unlike `buildApiBundle` (which bundles to a temp dir and imports
 * it for `dev`/`serve`), this writes a persistent, self-contained ESM module that
 * exports `apiHandler` / `apiRoutes` / `middleware` (see `apiEntrySource`) — the
 * runtime dispatchers are bundled in; npm/node deps stay external and resolve at
 * the deploy target. A deploy adapter (`server/adapters/`) imports this file and
 * hands requests to the handlers. Returns `{ routes, middleware }`, or `null`
 * when the project has neither API routes nor middleware.
 */
export async function emitApiBundle({ root, appDir, webEntry, exclude, i18n, outDir }) {
  const discovered = discoverApiRoutes(appDir, exclude);
  if (discovered.routes.length === 0 && discovered.middleware.length === 0) return null;

  const tmp = join(root, ".otfw-api-build");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "api-entry.js");
  writeFileSync(entry, apiEntrySource(discovered, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  mkdirSync(outDir, { recursive: true });
  await build({
    input: entry,
    platform: "node",
    resolve: { alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry }, extensions: EXTENSIONS },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
    output: { dir: outDir, format: "esm", entryFileNames: "api.js" },
    checks: { pluginTimings: false },
  });
  rmSync(tmp, { recursive: true, force: true });
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
 * Build the loader bundle and import it. Returns `{ loaders, files, cleanup }`
 * where `loaders` is the registry (`match`/`load`/`loadSerialized`/`handle` —
 * see `createLoaderRegistry`), or `null` when the app has no loader files.
 * Loaders are *plain server code*, bundled exactly like the API handler bundle:
 * no `otfwc` DOM transform, npm/node builtins external (DB drivers and native
 * modules resolve at runtime from the project's node_modules).
 */
export async function buildLoaderBundle({ root, appDir, webEntry, exclude, i18n, tmpName = ".otfw-loaders", bust }) {
  const files = discoverLoaders(appDir, exclude);
  if (files.length === 0) return null;

  const tmp = join(root, tmpName);
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "loaders-entry.js");
  writeFileSync(entry, loaderEntrySource(files, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  // Versioned filename, not a `?v=` query — Bun's ESM cache ignores the query for
  // file URLs, so only a new path re-evaluates the rebuilt module (see buildApiBundle).
  const outName = bust ? `loaders.${bust}.js` : "loaders.js";
  await build({
    input: entry,
    platform: "node",
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
    output: { dir: join(tmp, "out"), format: "esm", entryFileNames: outName },
    checks: { pluginTimings: false },
  });

  const mod = await import(pathToFileURL(join(tmp, "out", outName)).href);
  return {
    loaders: mod.loaders,
    files,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

/**
 * Emit the loader bundle to `outDir/loaders.js` for production (`dist/server/`,
 * next to `api.js`) — `otfw serve` imports it and runs loaders per request /
 * serves the `<path>/__data.json` endpoint. Returns `{ files }`, or `null` when
 * the app has no loader files.
 */
export async function emitLoaderBundle({ root, appDir, webEntry, exclude, i18n, outDir }) {
  const files = discoverLoaders(appDir, exclude);
  if (files.length === 0) return null;

  const tmp = join(root, ".otfw-loaders-build");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "loaders-entry.js");
  writeFileSync(entry, loaderEntrySource(files, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  mkdirSync(outDir, { recursive: true });
  await build({
    input: entry,
    platform: "node",
    resolve: { alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry }, extensions: EXTENSIONS },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
    output: { dir: outDir, format: "esm", entryFileNames: "loaders.js" },
    checks: { pluginTimings: false },
  });
  rmSync(tmp, { recursive: true, force: true });
  return { files };
}

/** The optional `app/routeGuard.{js,ts}` path, or null. */
export function findGuard(appDir) {
  return [join(appDir, "routeGuard.js"), join(appDir, "routeGuard.ts")].find(
    existsSync,
  );
}

/**
 * The app entry source: hand `mountApp` a route map of lazy `() => import()`
 * loaders (so each route code-splits into its own chunk) plus the optional guard.
 *
 * `loaderUrl(filePath)` maps each route file to the specifier its loader imports.
 * The production build imports the file directly (Rolldown code-splits it); the dev
 * server passes a `/__route/…` URL so the route compiles on first navigation.
 */
export function entrySource(pages, appDir, loaderUrl = (p) => p, i18n = null, nav = null, loaderRoutes = []) {
  const map = pages
    .map((p) => `    [${JSON.stringify(p)}]: () => import(${JSON.stringify(loaderUrl(p))}),`)
    .join("\n");
  const guard = findGuard(appDir);
  // Thread the i18n config (otfw.config) into `mountApp` so the client router knows
  // the locales and `router.locale` resolves from the URL prefix (docs/I18N.md §6).
  const i18nOpt =
    i18n && Array.isArray(i18n.locales) && i18n.locales.length
      ? `\n  i18n: ${JSON.stringify({ locales: i18n.locales, defaultLocale: i18n.defaultLocale })},`
      : "";
  // Navigation mode (otfw.config `nav`): "mpa" disables client-side link interception
  // (docs/HYDRATION.md §7). Only emitted when explicitly "mpa"; "spa" is the default.
  const navOpt = nav === "mpa" ? `\n  nav: "mpa",` : "";
  // Route patterns with a server loader (docs/DATA.md) — the router fetches
  // `<path>/__data.json` for these on navigation.
  const loadersOpt = loaderRoutes.length ? `\n  loaders: ${JSON.stringify(loaderRoutes)},` : "";
  return (
    `import { mountApp } from "@opentf/web";\n` +
    (guard ? `import guard from ${JSON.stringify(guard)};\n` : "") +
    `mountApp({\n  pages: {\n${map}\n  },\n` +
    `  target: document.getElementById("app"),${guard ? "\n  guard," : ""}${i18nOpt}${navOpt}${loadersOpt}\n});\n`
  );
}

/**
 * Crawl the module graph via `otfwc graph` and return a queryable handle. Used by
 * the dev server to invalidate precisely: `affected(file)` is every module that
 * transitively imports `file` (so editing it rebuilds exactly those route chunks).
 * `roots` are the entries to crawl from (the route/layout files + the runtime).
 */
export async function moduleGraph(otfwc, webEntry, roots) {
  const proc = Bun.spawn([otfwc, "graph", `--web=${webEntry}`, ...roots], {
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.unref(); // a short read-only crawl — never let it hold up shutdown
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) {
    console.error(`✗ otfwc graph failed:\n${await new Response(proc.stderr).text()}`);
    return { affected: () => new Set(), has: () => false };
  }
  let modules = [];
  try {
    modules = JSON.parse(stdout).modules;
  } catch {
    return { affected: () => new Set(), has: () => false };
  }
  // Reverse adjacency: target → importers, for transitive-dependents queries.
  const importers = new Map();
  for (const m of modules) {
    for (const dep of m.deps) {
      if (dep.external) continue;
      if (!importers.has(dep.target)) importers.set(dep.target, []);
      importers.get(dep.target).push(m.id);
    }
  }
  const ids = new Set(modules.map((m) => m.id));
  return {
    has: (id) => ids.has(id),
    affected(file) {
      const out = new Set();
      const queue = [file];
      while (queue.length) {
        const id = queue.shift();
        if (out.has(id)) continue;
        out.add(id);
        for (const importer of importers.get(id) || []) {
          if (!out.has(importer)) queue.push(importer);
        }
      }
      return out;
    },
  };
}

/**
 * Start a long-lived `otfwc serve` process and talk to it over a framed
 * stdin/stdout protocol (see crates/otfw_cli/src/main.rs `serve`). One process
 * compiles every module, so the toolchain pays the binary-startup cost once
 * instead of spawning a subprocess per file — the dominant dev-server cost.
 *
 * `compile(id, source, component, target)` resolves to the emitted JS or rejects
 * with the compiler diagnostic (`target` is `"csr"` | `"ssg"` | `"hydrate"`).
 * Requests are serialized through a FIFO queue: the server
 * is single-threaded, replies arrive in request order, so the head of the queue
 * always pairs with the next frame. The child is killed when this process exits.
 */
export function startCompilerServer(otfwc) {
  const proc = Bun.spawn([otfwc, "serve"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  // Don't let the long-lived child keep the event loop open: a one-shot `otfw build`
  // must exit once the bundle is written (the dev server stays alive on its own via
  // `Bun.serve`). The `exit` handler below still tears the child down, and the child
  // also sees EOF on its stdin pipe when we go.
  proc.unref();
  const reader = proc.stdout.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const queue = []; // { resolve, reject } in request order
  let buf = new Uint8Array(0);
  let pumping = false;
  let dead = false;

  const append = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const die = (err) => {
    dead = true;
    while (queue.length) queue.shift().reject(err);
  };

  // Drain reply frames as they arrive, resolving queued requests in order. A frame
  // is `<status> <byteLen>\n` followed by exactly `byteLen` bytes of payload.
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        let nl = buf.indexOf(10);
        while (nl === -1) {
          const { value, done } = await reader.read();
          if (done) return die(new Error("otfwc serve exited"));
          buf = append(buf, value);
          nl = buf.indexOf(10);
        }
        const [status, lenStr] = dec.decode(buf.subarray(0, nl)).split(" ");
        const len = Number(lenStr);
        while (buf.length < nl + 1 + len) {
          const { value, done } = await reader.read();
          if (done) return die(new Error("otfwc serve exited"));
          buf = append(buf, value);
        }
        const payload = dec.decode(buf.subarray(nl + 1, nl + 1 + len));
        buf = buf.slice(nl + 1 + len);
        const job = queue.shift();
        if (status === "OK") job.resolve(payload);
        else job.reject(new Error(payload));
      }
    } finally {
      pumping = false;
    }
  }

  function compile(id, source, component, target = "csr") {
    if (dead) return Promise.reject(new Error("otfwc serve is not running"));
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      const idB = enc.encode(id);
      const srcB = enc.encode(source);
      proc.stdin.write(enc.encode(`${idB.length} ${srcB.length} ${component ? 1 : 0} ${target}\n`));
      proc.stdin.write(idB);
      proc.stdin.write(srcB);
      proc.stdin.flush();
      pump();
    });
  }

  const close = () => {
    if (dead) return;
    dead = true;
    try {
      proc.stdin.end();
    } catch {}
    try {
      proc.kill();
    } catch {}
  };
  // Clean up the child whenever this process exits — for any reason and at any exit
  // code. We deliberately don't trap SIGINT/SIGTERM here: a helper shouldn't dictate
  // the whole process's exit code (that's the command's call), and the child also
  // receives the terminal's group signal directly. The `exit` hook is enough to avoid
  // leaking it. (One-shot builds exit when done; the dev server until it's stopped.)
  process.once("exit", close);

  return { compile, close };
}

/**
 * Rolldown plugin: compile `.jsx`/`.tsx` through the `otfwc` IR compiler. Page /
 * layout / 404 modules become factories; everything else a Custom Element. On a
 * compile error it emits a diagnostic stub (so one bad route doesn't sink the
 * build) unless `failOnError` is set (production builds should fail loudly).
 * `onResult(id, errorMessageOrNull)` is called per module so the dev server can
 * push compile diagnostics to the error overlay and clear them once fixed.
 *
 * Compilation runs through one persistent `otfwc serve` process per plugin instance
 * (see `startCompilerServer`). `target` picks the codegen backend: `"csr"` (the live
 * DOM build), `"ssg"` (HTML-string renderers), or `"hydrate"` (the dual module — a
 * CSR build factory plus an adopt factory for first-paint hydration).
 */
export function otfwPlugin(otfwc, { failOnError = false, onResult, target = "csr" } = {}) {
  const server = startCompilerServer(otfwc);
  return {
    name: "otfw",
    async transform(code, id) {
      if (!/\.(mdx|md|[jt]sx)$/.test(id)) return null;
      const base = id.split("/").pop().replace(/\.(mdx|md|[jt]sx)$/, "");
      const isPage = base === "page" || base === "layout" || base === "404";
      try {
        const out = await server.compile(id, code, !isPage, target);
        onResult?.(id, null);
        // Side effects (e.g. customElements.define) must survive bundling.
        return { code: out, moduleSideEffects: true };
      } catch (e) {
        const msg = e?.message ?? String(e);
        onResult?.(id, msg);
        if (failOnError) {
          this.error(`otfwc failed for ${id}:\n${msg}`);
        }
        console.error(`✗ otfwc failed for ${id}:\n${msg}`);
        const stub =
          `export default function () { const pre = document.createElement("pre");` +
          ` pre.style.cssText = "color:#f87171;padding:1rem;white-space:pre-wrap";` +
          ` pre.textContent = ${JSON.stringify(`Compile error in ${id}\n\n${msg}`)};` +
          ` return pre; }`;
        return { code: stub, moduleSideEffects: true };
      }
    },
  };
}

/**
 * CSS plugin: `import "./x.css"` injects a <style>; `*.module.css` resolves to an
 * identity class-name map (`styles.foo` → "foo"). Dev-grade CSS Modules.
 */
export function cssPlugin() {
  return {
    name: "css",
    transform(code, id) {
      if (!id.endsWith(".css")) return null;
      const inject =
        `const __s = document.createElement("style");` +
        ` __s.textContent = ${JSON.stringify(code)};` +
        ` document.head.appendChild(__s);`;
      const out = id.endsWith(".module.css")
        ? `${inject}\nexport default new Proxy({}, { get: (_, k) => k });`
        : `${inject}\nexport default ${JSON.stringify(code)};`;
      return { code: out, moduleSideEffects: true };
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
    `import { ${named} } from "@opentf/web";\n` +
    `export { renderRoute, renderHead, collectRoutePaths } from "@opentf/web/server";\n` +
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
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "ssg-entry.js");
  writeFileSync(entry, serverEntrySource(pages, i18n));

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
  // elements). Server render never instantiates them, but the base class must
  // exist so the class definitions evaluate. A bare stub suffices — no DOM
  // (customElements stays undefined, so elements self-register only in the browser).
  globalThis.HTMLElement ??= class {};
  const mod = await import(pathToFileURL(join(tmp, "out", "server.js")).href);
  return { mod, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
