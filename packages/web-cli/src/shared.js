// Shared plumbing for the OTF Web toolchain (`otfw dev` / `otfw build`).
//
// Both commands treat the current working directory as the project root (its
// `index.html` + `app/`), resolve `@opentf/web` via node resolution, run the
// `otfwc` IR compiler as a Rolldown `transform` plugin, and let Rolldown link the
// module graph. This module holds everything they have in common.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * Resolve the project and toolchain: the app being built (cwd), the runtime
 * package, the `otfwc` compiler, and the excluded routes. Exits with a clear
 * message on any hard failure. Builds the compiler on demand from the workspace.
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

  // Locate the `otfwc` compiler. Published: the prebuilt binary from `@opentf/web-compiler`
  // (a dependency of this CLI). In this repo's own dev (a Cargo workspace is found
  // above the CLI): the cargo `target/debug` build, rebuilt on demand. `OTFWC_BIN`
  // overrides both.
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const workspace = findUp("Cargo.toml", cliDir);
  let otfwc;
  if (process.env.OTFWC_BIN) {
    otfwc = process.env.OTFWC_BIN;
  } else if (workspace) {
    otfwc = join(workspace, "target", "debug", "otfwc");
    ensureCompiler(otfwc, workspace);
  } else {
    try {
      otfwc = otfwcPath();
    } catch (e) {
      fail(e.message);
    }
  }

  // forms-demo depends on @opentf/web-form, which is not yet ported to the new
  // runtime (it lands with the Project Graph). Override with EXCLUDE_ROUTES.
  const exclude = new Set(
    (process.env.EXCLUDE_ROUTES ?? "forms-demo").split(",").filter(Boolean),
  );

  return { root, appDir, webEntry, otfwc, workspace, exclude };
}

function ensureCompiler(otfwc, workspace) {
  if (existsSync(otfwc)) return;
  if (!workspace) fail(`otfwc compiler not found at ${otfwc}`);
  console.log("building compiler (cargo build -p otfw_cli)…");
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
    const { docsNavPlugin, blogPostsPlugin } = await import(pathToFileURL(entry).href);
    const plugins = [];
    // Resolves `@opentf/web-docs/nav` to the generated sidebar tree.
    if (docs) plugins.push(docsNavPlugin({ appDir, contentDir: docs.dir ?? "docs", exclude }));
    // Resolves `@opentf/web-docs/posts` to the generated post list.
    if (blog) plugins.push(blogPostsPlugin({ appDir, contentDir: blog.dir ?? "blog", exclude }));
    return plugins;
  } catch (e) {
    console.warn(
      `⚠ docs/blog config present but @opentf/web-docs could not be loaded: ${e?.message ?? e}`,
    );
    return [];
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
export function entrySource(pages, appDir, loaderUrl = (p) => p) {
  const map = pages
    .map((p) => `    [${JSON.stringify(p)}]: () => import(${JSON.stringify(loaderUrl(p))}),`)
    .join("\n");
  const guard = findGuard(appDir);
  return (
    `import { mountApp } from "@opentf/web";\n` +
    (guard ? `import guard from ${JSON.stringify(guard)};\n` : "") +
    `mountApp({\n  pages: {\n${map}\n  },\n` +
    `  target: document.getElementById("app"),${guard ? "\n  guard," : ""}\n});\n`
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
 * `compile(id, source, component, ssg)` resolves to the emitted JS or rejects with
 * the compiler diagnostic. Requests are serialized through a FIFO queue: the server
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

  function compile(id, source, component, ssg) {
    if (dead) return Promise.reject(new Error("otfwc serve is not running"));
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      const idB = enc.encode(id);
      const srcB = enc.encode(source);
      proc.stdin.write(enc.encode(`${idB.length} ${srcB.length} ${component ? 1 : 0} ${ssg ? 1 : 0}\n`));
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
 * (see `startCompilerServer`).
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
        const out = await server.compile(id, code, !isPage, target === "ssg");
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

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
