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
 * Generate the blog RSS feed when the project has a `blog` config and a base URL.
 * Scans the post folders, renders RSS 2.0, and writes `<siteDir>/<blogDir>/rss.xml`.
 * A project-supplied `public/<blogDir>/rss.xml` takes precedence (it overwrites ours
 * on the public/ copy). Returns `{ path, url, count }` or null (no blog / no base URL
 * / package missing). Resolved from the app's `@opentf/web-docs`.
 */
export async function runBlogFeed(root, appDir, config, siteDir, baseUrl, exclude = new Set()) {
  const blog = config?.blog;
  if (!blog) return null;
  if (!baseUrl) {
    console.warn("⚠ blog RSS feed skipped: no site URL (pass --base-url or set otfw.config)");
    return null;
  }
  const contentDir = blog.dir ?? "blog";
  if (existsSync(join(root, "public", contentDir, "rss.xml"))) return null; // honor override
  try {
    const entry = Bun.resolveSync("@opentf/web-docs/build", root);
    const { loadPosts, renderBlogFeed } = await import(pathToFileURL(entry).href);
    const posts = loadPosts({ appDir, contentDir, exclude });
    const feedPath = `/${contentDir}/rss.xml`;
    const title = blog.title || (config?.docs?.title ? `${config.docs.title} Blog` : "Blog");
    const xml = renderBlogFeed({
      posts,
      baseUrl,
      feedPath,
      channel: {
        title,
        description: blog.description || title,
        link: `/${contentDir}`,
      },
    });
    const out = join(siteDir, contentDir, "rss.xml");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, xml);
    return { path: feedPath, url: baseUrl.replace(/\/+$/, "") + feedPath, count: posts.length };
  } catch (e) {
    console.warn(`⚠ blog RSS feed skipped: ${e?.message ?? e}`);
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
export function entrySource(pages, appDir, loaderUrl = (p) => p, i18n = null, nav = null) {
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
  return (
    `import { mountApp } from "@opentf/web";\n` +
    (guard ? `import guard from ${JSON.stringify(guard)};\n` : "") +
    `mountApp({\n  pages: {\n${map}\n  },\n` +
    `  target: document.getElementById("app"),${guard ? "\n  guard," : ""}${i18nOpt}${navOpt}\n});\n`
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
