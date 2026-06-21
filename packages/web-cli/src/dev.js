// `otfw dev` — the CSR dev server.
//
// Drives Rolldown in watch mode (the `otfwc` compiler as a transform plugin) and
// serves the project's index.html with WebSocket live-reload on rebuild. Tailwind
// stylesheets are compiled on the fly (see ./tailwind.js). The project root is the
// current working directory, like `vite` / `next dev`.

import { watch } from "rolldown";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compileCss, usesTailwind } from "./tailwind.js";
import { overlayClient } from "./overlay.js";
import {
  EXTENSIONS,
  MIME,
  cssPlugin,
  discoverPages,
  entrySource,
  loadProject,
  otfwPlugin,
} from "./shared.js";

// Resolve the *preferred* start port: `--port <n>` / `-p <n>` / `--port=<n>` on
// the CLI wins, then the PORT env var, else 3000. The server scans upward from here
// for the first free port (see `serveFrom`).
function resolveStartPort() {
  const argv = process.argv.slice(3); // args after `dev`
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--port" || a === "-p") && argv[i + 1]) return Number(argv[i + 1]);
    if (a.startsWith("--port=")) return Number(a.slice("--port=".length));
  }
  if (process.env.PORT) return Number(process.env.PORT);
  return 3000;
}

// Start `Bun.serve` on the first free port at or above `start` (EADDRINUSE → next).
function serveFrom(start, options) {
  for (let port = start; port < start + 100; port++) {
    try {
      return Bun.serve({ ...options, port });
    } catch (e) {
      if (e?.code === "EADDRINUSE") continue;
      throw e;
    }
  }
  console.error(`✗ no free port found in ${start}–${start + 99}`);
  process.exit(1);
}

export async function runDev() {
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const requested = resolveStartPort();
  const startPort = Number.isFinite(requested) ? requested : 3000;

  const pages = discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    process.exit(1);
  }

  const devDir = join(root, ".dev");
  mkdirSync(join(devDir, "csr"), { recursive: true });
  const entry = join(devDir, "entry.js");
  writeFileSync(entry, entrySource(pages, appDir));

  // WebSocket HMR: clients on the "hmr" topic get JSON messages — a successful
  // rebuild sends { type: "reload" }; a compile/build failure sends
  // { type: "error" } so the injected overlay shows it over the last good page.
  let server;
  const publish = (msg) => server?.publish("hmr", JSON.stringify(msg));
  // Per-module compile diagnostics (keyed by id); a clean build clears them.
  const compileErrors = new Map();

  const watcher = watch({
    input: entry,
    resolve: { alias: { "@opentf/web": webEntry }, extensions: EXTENSIONS },
    plugins: [
      otfwPlugin(otfwc, {
        onResult: (id, err) => (err ? compileErrors.set(id, err) : compileErrors.delete(id)),
      }),
      cssPlugin(),
    ],
    output: {
      dir: join(devDir, "csr"),
      format: "esm",
      entryFileNames: "bundle.js",
    },
  });
  watcher.on("event", (e) => {
    if (e.code === "BUNDLE_END") {
      e.result?.close?.();
      if (compileErrors.size > 0) {
        const [id, message] = [...compileErrors][0];
        console.error(`✗ ${compileErrors.size} compile error(s)`);
        publish({ type: "error", kind: "compile", id, message });
      } else {
        console.log(`✓ bundled in ${e.duration}ms`);
        publish({ type: "reload" });
      }
    } else if (e.code === "ERROR") {
      const message = e.error?.message ?? String(e.error);
      console.error("✗ build error:\n", message);
      publish({ type: "error", kind: "build", message, stack: e.error?.stack });
    }
  });

  const indexPath = join(root, "index.html");

  // Injected into the served HTML: our bundle + the dev error overlay / reload
  // client (reconnects and reloads once the server is back after a restart).
  const injected =
    `<script type="module" src="/bundle.js"></script>\n` +
    `<script>${overlayClient}</script>\n`;

  // Use the project's index.html as the shell, stripping any module entry script
  // (the app would be double-loaded) and injecting our bundle + reload client.
  function buildHtml() {
    let html;
    if (existsSync(indexPath)) {
      html = readFileSync(indexPath, "utf8").replace(
        /<script\s+type=["']module["'][^>]*src=[^>]*>\s*<\/script>\s*/gi,
        "",
      );
    } else {
      html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenTF Web</title></head><body><div id="app"></div></body></html>`;
    }
    return html.includes("</body>")
      ? html.replace("</body>", `${injected}</body>`)
      : html + injected;
  }

  // Serve a static file from the project root (no traversal outside it). Tailwind
  // entry stylesheets are compiled on request.
  async function serveStatic(pathname) {
    const file = join(root, pathname);
    if (!file.startsWith(root) || !existsSync(file)) return null;
    const ext = pathname.split(".").pop();
    if (ext === "css") {
      const source = readFileSync(file, "utf8");
      const css = usesTailwind(source)
        ? await compileCss(file, source, root).catch((err) => {
            console.error(`✗ tailwind failed for ${pathname}:\n${err?.message ?? err}`);
            return source;
          })
        : source;
      return new Response(css, { headers: { "content-type": "text/css" } });
    }
    return new Response(readFileSync(file), {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  }

  server = serveFrom(startPort, {
    websocket: {
      open: (ws) => {
        ws.subscribe("hmr");
        // A client connecting while a compile error is outstanding sees it now.
        if (compileErrors.size > 0) {
          const [id, message] = [...compileErrors][0];
          ws.send(JSON.stringify({ type: "error", kind: "compile", id, message }));
        }
      },
    },
    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      if (pathname === "/__hmr") {
        return srv.upgrade(req)
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      }
      // Built output: the entry bundle and code-split chunks live in .dev/csr.
      if (pathname.endsWith(".js")) {
        const built = join(devDir, "csr", pathname);
        if (built.startsWith(join(devDir, "csr") + "/") && existsSync(built)) {
          return new Response(readFileSync(built), {
            headers: { "content-type": "text/javascript" },
          });
        }
        if (pathname === "/bundle.js") {
          return new Response("// building…", {
            headers: { "content-type": "text/javascript" },
          });
        }
      }
      // Static assets referenced by index.html (css, public/, etc).
      if (pathname !== "/") {
        const asset = await serveStatic(pathname);
        if (asset) return asset;
        if (/\.[a-z0-9]+$/i.test(pathname)) {
          return new Response("not found", { status: 404 });
        }
      }
      return new Response(buildHtml(), {
        headers: { "content-type": "text/html" },
      });
    },
  });

  console.log(`\n  OpenTF Web dev server`);
  console.log(`  → http://localhost:${server.port}  (${pages.length} routes)\n`);
}
