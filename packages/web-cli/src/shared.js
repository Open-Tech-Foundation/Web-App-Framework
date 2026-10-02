// Shared plumbing for the OTF Web toolchain (`otfw dev` / `otfw build`).
//
// Both commands treat the current working directory as the project root (its
// `index.html` + `app/`), resolve `@opentf/web` via node resolution, compile
// sources through the `@opentf/esdev-plugin-web` transform plugin, and let the
// runtime's bundler link the module graph. This module holds everything they
// have in common.

import { build } from "runtime:build";
import { stat } from "runtime:fs";
import { dirname, fromFileURL, join, resolve, toFileURL } from "runtime:path";
import { args, cwd, env, exit, onSignal } from "runtime:process";

import { quiet } from "./reporter.js";

import {
  b64url,
  exists,
  findUp,
  mkdirp,
  packageDir,
  readBytes,
  readEntries,
  readText,
  resolveFrom,
  rmrf,
  run,
  writeFile,
} from "./runtime.js";

// The otfwc compiler service and the `runtime:build` transform plugin live in
// `@opentf/esdev-plugin-web` (driving `runtime:build` is the same surface for
// the CLI and for anyone else bundling OTF sources). Imported here for the
// SSG build below and re-exported so the command modules keep a single import
// site.
import {
  closeCompilers,
  compileError,
  otfwPlugin,
  resolveCompiler,
  startCompilerServer,
} from "@opentf/esdev-plugin-web";

export {
  closeCompilers,
  compileError,
  otfwPlugin,
  resolveCompiler,
  startCompilerServer,
};

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
  wasm: "application/wasm",
  gif: "image/gif",
  webp: "image/webp",
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
export async function readHtmlShell(root) {
  const indexPath = join(root, "index.html");
  const html = (await exists(indexPath)) ? await readText(indexPath) : DEFAULT_HTML_SHELL;
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

export { findUp };

/**
 * The project to build: the working directory, or the directory `--root=<dir>` names.
 *
 * The runtime sandboxes the toolchain to its working directory — nothing it runs can
 * reach outside, which is why `otfw` in an installed project needs no flag: the
 * project is where you stand. A workspace that develops its own CLI is one project
 * containing several: the CLI, the app, and the packages the app links to all live
 * under the repository root, so the toolchain runs from there and `--root` says which
 * app to build. Both cases resolve to a directory inside the sandbox.
 */
export function projectRoot(argv = args) {
  const flag = argv.find((a) => a.startsWith("--root="));
  return flag ? resolve(cwd(), flag.slice("--root=".length)) : cwd();
}

/**
 * Resolve the project and toolchain: the app being built, the runtime package, the
 * `otfwc` compiler, and the excluded routes. Exits with a clear message on any hard
 * failure. Source checkouts can build the compiler on demand from this repo's Cargo
 * workspace; published installs use @opentf/web-compiler.
 */
export async function loadProject() {
  const root = projectRoot();

  const appDir = join(root, "app");
  if (!(await exists(appDir))) {
    fail(
      `no app/ directory in ${root}\n` +
        `  run otfw from your project root (the folder with index.html and app/),\n` +
        `  or pass --root=<dir> to point at it.`,
    );
  }

  // Resolve the runtime the way the bundler will, so it works as an installed
  // dependency or a workspace package — no hardcoded path.
  let webEntry;
  try {
    webEntry = await resolveFrom("@opentf/web", root);
  } catch {
    fail(`cannot resolve "@opentf/web" from ${root}\n  add it to your dependencies.`);
  }

  // Locate the `otfwc` compiler. Explicit overrides win, then the packaged
  // compiler binary, then this repo's local Rust workspace as a source fallback.
  const { otfwc, workspace } = await resolveCompiler();

  // Route directories to skip during discovery — comma-separated names in
  // EXCLUDE_ROUTES. None are excluded by default.
  const exclude = new Set((env.EXCLUDE_ROUTES ?? "").split(",").filter(Boolean));

  return { root, appDir, webEntry, otfwc, workspace, exclude };
}

/** The config filenames a project may use, in precedence order. */
export const CONFIG_FILENAMES = ["otfw.config.json", "otfw.config.js", "otfw.config.mjs"];

/**
 * Re-import a JS module after it changed on disk. The runtime's ESM cache is keyed by
 * file path and ignores a `?v=` query, so the only way to re-evaluate a module is
 * to import a genuinely new path. Bundling to a versioned file (rather than copying it)
 * inlines the module's own relative imports, so the copy's location can't change how
 * they resolve. Returns the imported module — the original file's when bundling fails.
 *
 * `slot` namespaces the generated file, so two callers (the project config, a docs
 * `_meta.js`) can't overwrite each other's copy.
 */
async function freshModuleUrl(file, cacheDir, bust, slot) {
  const dir = join(cacheDir, slot);
  const name = `${bust}.mjs`;
  // The whole sequence — through the finished module load — runs serialized
  // (see below): a second rebuild must not rmrf this slot between our write
  // and our import. Note the import itself is inside the lock on purpose: the
  // loader reads the file lazily, so releasing after the `import()` call but
  // before its bytes are read races exactly the same way.
  return serializeFreshModule(() => freshModuleUrlInner(file, dir, name));
}

// Serializes fresh-module loads process-wide. Overlapping dev rebuilds used
// to interleave here — rebuild B's rmrf deleted rebuild A's just-written
// versioned file before A's import landed (`4.mjs` gone, `5.mjs` on disk) —
// surfacing as "could not load _meta.js" warnings with a degraded nav.
// Concurrent builds now queue behind each other instead.
let freshModuleTail = Promise.resolve();
function serializeFreshModule(job) {
  const run = () => job();
  const p = freshModuleTail.then(run, run);
  freshModuleTail = p.catch(() => {});
  return p;
}

async function freshModuleUrlInner(file, dir, name) {
  let url;
  try {
    await rmrf(dir);
    const bundle = await build({
      input: file,
      platform: "node",
      // Keep npm/node imports external — the module may pull in real dependencies.
      external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    });
    try {
      await bundle.write({ dir, format: "esm", entryFileNames: name });
    } finally {
      await bundle.close();
    }
    url = toFileURL(join(dir, name)).href;
  } catch (e) {
    console.warn(`⚠ could not re-bundle ${file}: ${e?.message ?? e}`);
    url = toFileURL(file).href;
  }
  return import(url);
}

/**
 * A `(file) => Promise<module>` that always reflects what is on disk, for the dev
 * server to hand to build plugins that read JS data files (the docs `_meta.js`, say).
 * A plain `import()` would hand back the module as it was when the server started —
 * see {@link freshModuleUrl} — and re-bundling on every build would be wasteful, so
 * the result is memoized on the file's size + mtime and only redone when it changes.
 */
export function moduleReloader(cacheDir) {
  const cache = new Map(); // file → { key, mod }
  let version = 0;
  return async function importFresh(file) {
    const st = await stat(file);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.mod;
    const slot = `mod-${b64url(file).slice(-24)}`;
    const mod = await freshModuleUrl(file, cacheDir, ++version, slot);
    cache.set(file, { key, mod });
    return mod;
  };
}

/**
 * Load the optional project config (`otfw.config.{json,js,mjs}`) as a plain object.
 * Read by the build for the site URL (SEO) and the `docs` block (docs generator).
 *
 * `bust` (with `cacheDir`) re-reads a JS config that has changed on disk — the dev
 * server passes an incrementing version so a config edit takes effect without a
 * restart. Without it the module is imported once and cached by the runtime.
 */
export async function loadConfig(root, { bust = 0, cacheDir = join(root, ".dev") } = {}) {
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
        const mod = bust ? await freshModuleUrl(p, cacheDir, bust, "config") : await import(toFileURL(p).href);
        return mod.default ?? {};
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
 * The docs navigation bundler plugin, when the project opts into the docs
 * generator (a `docs` block in otfw.config). Resolved from `@opentf/web-docs`
 * (the app's own dependency); returns null when docs aren't configured or the
 * package isn't installed, so the core toolchain stays untouched for normal apps.
 *
 * `importModule` (dev only) is how the nav generator re-reads a `_meta.js` that
 * changed since the server started — see {@link moduleReloader}. Omitted for a
 * one-shot build, where a plain `import()` reads each file exactly once anyway.
 */
export async function loadDocsPlugins(root, appDir, config, exclude = new Set(), importModule) {
  const docs = config?.docs;
  const blog = config?.blog;
  if (!docs && !blog) return [];
  try {
    const entry = await resolveFrom("@opentf/web-docs/build", root);
    const { docsNavPlugin, blogPostsPlugin, lastUpdatedPlugin } = await import(toFileURL(entry).href);
    const plugins = [];
    // Resolves `@opentf/web-docs/nav` to a section map — one generated tree per top-level
    // folder under app/. Any folder with a DocsLayout becomes a section automatically.
    if (docs) plugins.push(docsNavPlugin({ appDir, exclude, importModule }));
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

/**
 * The app-relative key a route file gets in the client route map (`/app/docs/page.jsx`).
 * Keeps the `/app` segment because the runtime's `routeFromPath` anchors on it.
 */
export function routeKey(filePath, appDir) {
  return `/app${stripAppPrefix(filePath, appDir)}`;
}

/** The route pattern a page/layout/404 file registers under — mirrors the runtime's
 *  `routeFromPath` (packages/web/runtime/router.js), but anchored on the known `appDir`. */
function routePatternFor(filePath, appDir) {
  const r = stripAppPrefix(filePath, appDir).replace(/\/(page|layout|404)\.(jsx|tsx|mdx|md)$/, "");
  return r === "" ? "/" : r;
}

/**
 * Which code-split chunks each route's first paint needs, as `/assets/…` hrefs — the
 * page chunk, its layout chain's chunks, and everything those statically import.
 *
 * Without this the browser can't know: the pre-rendered HTML references only the CSS and
 * `bundle.js`, so the route chunks are discovered only *after* `bundle.js` downloads and
 * runs, serializing HTML → bundle → route chunks. Emitting `<link rel="modulepreload">`
 * for them in the `<head>` lets the preload scanner fetch them alongside `bundle.js`.
 *
 * Chunks the entry bundle already pulls in statically are excluded — they arrive with
 * `bundle.js` regardless, so preloading them would just duplicate work.
 *
 * Returns `{ routes: { [pattern]: hrefs }, notFound: hrefs }`. The 404 page carries no
 * layouts, matching `layoutChain(null)` in the runtime.
 */
export function routeChunkManifest({ output, pages, appDir, entryFileName, assetBase = "/assets/" }) {
  const chunks = output.filter((o) => o.type === "chunk");
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const byModule = new Map();
  // A chunk is found by any module inside it: the bundler reports no facade id, and a
  // page that got merged into a shared chunk still has to resolve to that chunk.
  for (const c of chunks) {
    for (const id of c.moduleIds || []) if (!byModule.has(id)) byModule.set(id, c);
  }

  // Transitive static-import closure of a chunk, as file names, BFS from the chunk itself.
  const closure = (start) => {
    const seen = new Set();
    const queue = [start];
    while (queue.length) {
      const file = queue.shift();
      if (!file || seen.has(file)) continue;
      seen.add(file);
      for (const imp of byFile.get(file)?.imports || []) queue.push(imp);
    }
    return seen;
  };
  const eager = closure(entryFileName);

  // Split the discovered route files exactly the way `registerRoutes` does.
  const layouts = new Map();
  const pageFiles = new Map();
  let notFoundFile = null;
  for (const p of pages) {
    if (/\/404\.(jsx|tsx)$/.test(p)) notFoundFile = p;
    else if (/\/layout\.(jsx|tsx)$/.test(p)) layouts.set(routePatternFor(p, appDir), p);
    else pageFiles.set(routePatternFor(p, appDir), p);
  }

  const layoutChainFor = (route) => {
    const chain = [];
    let p = route;
    while (true) {
      if (layouts.has(p)) chain.unshift(layouts.get(p));
      if (p === "/") break;
      p = p.slice(0, p.lastIndexOf("/")) || "/";
    }
    return chain;
  };

  const hrefsFor = (files) => {
    const out = [];
    const seen = new Set();
    for (const file of files) {
      const chunk = byModule.get(file);
      if (!chunk) continue;
      for (const name of closure(chunk.fileName)) {
        if (eager.has(name) || seen.has(name)) continue;
        seen.add(name);
        out.push(assetBase + name);
      }
    }
    return out;
  };

  const routes = {};
  for (const [route, file] of pageFiles) {
    routes[route] = hrefsFor([file, ...layoutChainFor(route)]);
  }
  return { routes, notFound: notFoundFile ? hrefsFor([notFoundFile]) : [] };
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

/** Print the route/page/loader conflicts and exit — shared by build, dev, and serve. */
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
  const discovered = await discoverApiRoutes(appDir, exclude);
  if (discovered.routes.length === 0 && discovered.middleware.length === 0) return null;

  const tmp = join(root, tmpName);
  await mkdirp(tmp);
  const entry = join(tmp, "api-entry.js");
  await writeFile(entry, apiEntrySource(discovered, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  // `bust` versions the emitted *filename* so `otfw dev` picks up handler edits on
  // rebuild — the ESM cache is keyed by file path and ignores a `?v=` query, so
  // only a genuinely new path re-evaluates the module.
  const outName = bust ? `api.${bust}.js` : "api.js";
  const bundle = await build({
    input: entry,
    platform: "node",
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    // Keep npm/node builtins external — server handlers resolve them at runtime.
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
  });
  try {
    await bundle.write({ dir: join(tmp, "out"), format: "esm", entryFileNames: outName });
  } finally {
    await bundle.close();
  }

  const mod = await import(toFileURL(join(tmp, "out", outName)).href);
  return {
    handler: mod.apiHandler,
    apiRoutes: mod.apiRoutes,
    middleware: mod.middleware,
    routes: discovered.routes,
    middlewareFiles: discovered.middleware,
    cleanup: () => rmrf(tmp),
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
 * Build the loader bundle and import it. Returns `{ loaders, files, cleanup }`
 * where `loaders` is the registry (`match`/`load`/`loadSerialized`/`handle` —
 * see `createLoaderRegistry`), or `null` when the app has no loader files.
 * Loaders are *plain server code*, bundled exactly like the API handler bundle:
 * no `otfwc` DOM transform, npm/node builtins external (DB drivers and native
 * modules resolve at runtime from the project's node_modules).
 */
export async function buildLoaderBundle({ root, appDir, webEntry, exclude, i18n, tmpName = ".otfw-loaders", bust }) {
  const files = await discoverLoaders(appDir, exclude);
  if (files.length === 0) return null;

  const tmp = join(root, tmpName);
  await mkdirp(tmp);
  const entry = join(tmp, "loaders-entry.js");
  await writeFile(entry, loaderEntrySource(files, appDir, i18n));

  const serverApi = join(dirname(webEntry), "server", "index.js");
  // Versioned filename, not a `?v=` query — the ESM cache ignores the query for
  // file URLs, so only a new path re-evaluates the rebuilt module (see buildApiBundle).
  const outName = bust ? `loaders.${bust}.js` : "loaders.js";
  const bundle = await build({
    input: entry,
    platform: "node",
    resolve: {
      alias: { "@opentf/web/server": serverApi, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@opentf/web"),
  });
  try {
    await bundle.write({ dir: join(tmp, "out"), format: "esm", entryFileNames: outName });
  } finally {
    await bundle.close();
  }

  const mod = await import(toFileURL(join(tmp, "out", outName)).href);
  return {
    loaders: mod.loaders,
    files,
    cleanup: () => rmrf(tmp),
  };
}

/**
 * Emit the loader bundle to `outDir/loaders.js` for production (`dist/server/`,
 * next to `api.js`) — `otfw serve` imports it and runs loaders per request /
 * serves the `<path>/__data.json` endpoint. Returns `{ files }`, or `null` when
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

/** The optional `app/routeGuard.{js,ts}` path, or null. */
export async function findGuard(appDir) {
  for (const f of [join(appDir, "routeGuard.js"), join(appDir, "routeGuard.ts")]) {
    if (await exists(f)) return f;
  }
  return undefined;
}

/**
 * The app entry source: hand `mountApp` a route map of lazy `() => import()`
 * loaders (so each route code-splits into its own chunk) plus the optional guard.
 *
 * `loaderUrl(filePath)` maps each route file to the specifier its loader imports.
 * The production build imports the file directly (the bundler code-splits it); the dev
 * server passes a `/__route/…` URL so the route compiles on first navigation.
 *
 * The map *keys* ship in the entry bundle, so they're app-relative (`/app/docs/page.jsx`),
 * not absolute. `registerRoutes` only ever reads the part from `/app` onward
 * (`routeFromPath`), so this is byte-for-byte equivalent at runtime — while an absolute
 * key repeats the build machine's directory prefix once per route (kilobytes on the
 * critical path, and it leaks the CI checkout layout to every visitor).
 */
export async function entrySource(pages, appDir, loaderUrl = (p) => p, i18n = null, nav = null, loaderRoutes = []) {
  const map = pages
    .map((p) => `    [${JSON.stringify(routeKey(p, appDir))}]: () => import(${JSON.stringify(loaderUrl(p))}),`)
    .join("\n");
  const guard = await findGuard(appDir);
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
  // A short read-only crawl. Nothing awaits the child beyond this call, and a child
  // nobody waits on holds nothing open, so there is no `unref` to do.
  const { ok, stdout, stderr } = await run(otfwc, ["graph", `--web=${webEntry}`, ...roots]);
  if (!ok) {
    console.error(`✗ otfwc graph failed:\n${stderr}`);
    return { affected: () => new Set(), has: () => false, files: () => [] };
  }
  let modules = [];
  try {
    modules = JSON.parse(stdout).modules;
  } catch {
    return { affected: () => new Set(), has: () => false, files: () => [] };
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
    // Every module in the graph — the dev server watches their directories so an
    // edit to a file outside `app/` (a shared `lib/`, `src/`, … module) rebuilds too.
    files: () => [...ids],
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

// A relative `new URL("./x", import.meta.url)` reference, optionally wrapped in a
// `new Worker(...)` / `new SharedWorker(...)`. The specifier is restricted to a
// static, relative, expression-free literal (`./` or `../`, single/double/back
// quotes, no `${…}`) — the only shape we can resolve to a file at build time.
const NEW_URL_RE =
  /new\s+URL\(\s*(["'`])(\.\.?\/[^"'`${}\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const WORKER_PREFIX_RE = /new\s+(?:Shared)?Worker\(\s*$/;
// A JS-ish `new URL` target (`.js`, `.mjs`, `.ts`, …) is executable code — a worker,
// `importScripts` target, or module to load — so it's bundled as a chunk (imports
// resolved, nested refs recursed) rather than copied verbatim like a binary asset.
const SCRIPT_EXT_RE = /\.[mc]?[jt]sx?$/i;

/**
 * Whether a resolved `new URL` target should be bundled as its own chunk (workers
 * and any JS-ish script — so imports resolve and nested `new URL` refs recurse)
 * versus emitted/served as a verbatim asset (`.wasm`, images, fonts, …). `isWorker`
 * forces a chunk regardless of extension (a `new Worker(new URL(…))` target).
 */
export function shouldChunkNewUrl(absPath, isWorker) {
  return isWorker || SCRIPT_EXT_RE.test(absPath);
}

/**
 * Scan `code` for the `new URL(<relative literal>, import.meta.url)` convention.
 * Returns one entry per occurrence: `{ start, end, spec, isWorker }`, where
 * `[start, end)` spans the whole `new URL(…)` expression, `spec` is the relative
 * specifier, and `isWorker` is true when it's the argument of `new Worker(…)` /
 * `new SharedWorker(…)`. Empty when nothing matched (cheap bail on no
 * `import.meta.url`), so callers can skip untouched modules.
 */
export function scanNewUrlRefs(code) {
  if (!code.includes("import.meta.url")) return [];
  const refs = [];
  for (const m of code.matchAll(NEW_URL_RE)) {
    refs.push({
      start: m.index,
      end: m.index + m[0].length,
      spec: m[2],
      isWorker: WORKER_PREFIX_RE.test(code.slice(0, m.index)),
    });
  }
  return refs;
}

// Apply `{ start, end, text }` edits to `code`, splicing right-to-left so earlier
// offsets stay valid (and duplicate literals can't be mis-replaced).
export function applyNewUrlEdits(code, edits) {
  let out = code;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Resolve a `new URL` specifier to an absolute on-disk path from within a plugin
 * `transform` hook. Prefers the bundler's own resolver (`ctx.resolve`) so it follows
 * symlink realpaths, package `exports` maps, and non-standard
 * `node_modules` layouts — the naive `dirname(importer) + spec` only works when the
 * target is a literal filesystem sibling. Falls back to that join, then returns
 * `null` if the file genuinely isn't there (caller warns — never silently drops).
 */
export async function resolveNewUrlRef(ctx, spec, importer) {
  try {
    const r = await ctx.resolve(spec, importer);
    if (r && !r.external && (await exists(r.id))) return r.id;
  } catch {
    // fall through to the filesystem join below
  }
  const abs = join(dirname(importer), spec);
  return (await exists(abs)) ? abs : null;
}

/**
 * Worker & asset plugin (`otfw build`): teaches the bundler the `new Worker(new URL(…,
 * import.meta.url))` / bare `new URL(…, import.meta.url)` convention that the
 * runtime (and user code) uses to reference sibling worker scripts and binary
 * assets (`.wasm`, images, …). The bundler leaves these as dangling runtime strings,
 * so the referenced file is never emitted and 404s in production. This mirrors
 * what Vite's `vite:worker` + `vite:asset` plugins do:
 *
 *   1. detect `new URL(<relative literal>, import.meta.url)`,
 *   2. resolve the literal relative to the importing module,
 *   3. emit it — a `new Worker(…)` target as its own `{ type: "chunk" }` entry (so
 *      it's bundled and its own imports, incl. nested workers, recurse through this
 *      same plugin), everything else as a `{ type: "asset" }`,
 *   4. rewrite the expression to the hashed output URL via the bundler's
 *      `import.meta.ROLLUP_FILE_URL_<referenceId>` placeholder.
 */
export function workerAssetsPlugin() {
  // Resolved absolute path → emitted referenceId, so a file referenced from several
  // places is emitted (and hashed) once. Keyed by path alone — NOT by how it was
  // referenced — so a file used as both a worker/script and a bare `new URL` collapses
  // to a single output. Whether it's a chunk or an asset is decided by the target
  // itself (`shouldChunk`), never by which reference happened to be scanned first: a
  // script must always be a bundled chunk (so its own nested `new URL` refs recurse),
  // never downgraded to a verbatim `{ type: "asset" }` copy that would leave them
  // dangling and 404 at runtime.
  let refs;
  return {
    name: "otfw:worker-assets",
    start: {
      handler() {
        refs = new Map();
      },
    },
    transform: {
      filter: { id: /\.[mc]?[jt]sx?$/ },
      async handler(code, id, ctx) {
      const found = scanNewUrlRefs(code);
      if (found.length === 0) return null;

      const edits = [];
      for (const ref of found) {
        const abs = await resolveNewUrlRef(ctx, ref.spec, id);
        if (!abs) {
          // Never drop it silently: a dangling `new URL` 404s at runtime, and the
          // whole point of this plugin is to make that impossible to ship unnoticed.
          ctx.warn(
            `could not resolve new URL(${JSON.stringify(ref.spec)}, import.meta.url) ` +
              `in ${id} — left as-is; it will 404 at runtime`,
          );
          continue;
        }
        let refId = refs.get(abs);
        if (refId === undefined) {
          refId = shouldChunkNewUrl(abs, ref.isWorker)
            ? ctx.emit({ type: "chunk", id: abs, importer: id })
            : ctx.emit({ type: "asset", name: abs.split("/").pop(), source: await readBytes(abs) });
          refs.set(abs, refId);
        }
        edits.push({
          start: ref.start,
          end: ref.end,
          text: `new URL(import.meta.ROLLUP_FILE_URL_${refId}, import.meta.url)`,
        });
      }
      if (edits.length === 0) return null;
      return { code: applyNewUrlEdits(code, edits), moduleSideEffects: true };
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
    `import { ${named} } from "@opentf/web";\n` +
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

/**
 * Resolve the site-wide `<head>` for a plain CSR build (docs: Metadata & SEO, the
 * "Plain CSR" row). A CSR SPA serves one `index.html` shell for *every* route, so only
 * the root layout's route-independent metadata belongs in it — favicon/other `links`,
 * a site-wide `description`, Open Graph site defaults, `robots`, extra `meta`/`jsonLd`
 * — but never a per-page `title` or `canonical` (which would be wrong on every other
 * route). Compiles just the root `app/layout.{jsx,tsx}` (not the whole app) with the
 * SSG backend and renders its metadata in route-independent mode (`path: null`).
 * Returns the head HTML, or "" when there is no root layout or it declares no metadata.
 */
export async function resolveLayoutShellHead({ root, appDir, pages, webEntry, otfwc, docsPlugins = [], baseUrl = "" }) {
  const rootLayout = pages.find((p) => p === join(appDir, "layout.jsx") || p === join(appDir, "layout.tsx"));
  if (!rootLayout) return "";
  const { mod, cleanup } = await buildServerBundle({
    root,
    pages: [rootLayout],
    webEntry,
    otfwc,
    docsPlugins,
    tmpName: ".otfw-csr-head",
  });
  try {
    // `entry: null` → layout chain only (no page); `path: null` → route-independent head.
    const meta = await mod.resolveMetadata({ route: "/", entry: null });
    return mod.renderHead(meta, { path: null, baseUrl });
  } finally {
    cleanup();
  }
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  exit(1);
}
