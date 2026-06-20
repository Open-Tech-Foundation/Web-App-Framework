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
import {
  EXTENSIONS,
  MIME,
  cssPlugin,
  discoverPages,
  entrySource,
  loadProject,
  otfwPlugin,
} from "./shared.js";

export async function runDev() {
  const { root, appDir, webEntry, otfwc, exclude } = loadProject();
  const port = Number(process.env.PORT ?? 5175);

  const pages = discoverPages(appDir, exclude);
  if (pages.length === 0) {
    console.error(`✗ no page.jsx files found under ${appDir}`);
    process.exit(1);
  }

  const devDir = join(root, ".dev");
  mkdirSync(join(devDir, "csr"), { recursive: true });
  const entry = join(devDir, "entry.js");
  writeFileSync(entry, entrySource(pages, appDir));

  // WebSocket HMR: clients on the "hmr" topic reload on each successful rebuild.
  let server;
  const reload = () => server?.publish("hmr", "reload");

  const watcher = watch({
    input: entry,
    resolve: { alias: { "@opentf/web": webEntry }, extensions: EXTENSIONS },
    plugins: [otfwPlugin(otfwc), cssPlugin()],
    output: {
      dir: join(devDir, "csr"),
      format: "esm",
      entryFileNames: "bundle.js",
    },
  });
  watcher.on("event", (e) => {
    if (e.code === "BUNDLE_END") {
      console.log(`✓ bundled in ${e.duration}ms`);
      e.result?.close?.();
      reload();
    } else if (e.code === "ERROR") {
      console.error("✗ build error:\n", e.error?.message ?? e.error);
    }
  });

  const indexPath = join(root, "index.html");

  // Injected into the served HTML: our bundle + the reload client (reconnects and
  // reloads once the server is back after a restart).
  const injected =
    `<script type="module" src="/bundle.js"></script>\n` +
    `<script>(() => {\n` +
    `  const url = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/__hmr";\n` +
    `  const connect = () => {\n` +
    `    const ws = new WebSocket(url);\n` +
    `    ws.onmessage = () => location.reload();\n` +
    `    ws.onclose = () => setTimeout(connect, 1000);\n` +
    `  };\n` +
    `  connect();\n` +
    `})();</script>\n`;

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

  server = Bun.serve({
    port,
    websocket: { open: (ws) => ws.subscribe("hmr") },
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
  console.log(`  → http://localhost:${port}  (${pages.length} routes)\n`);
}
