#!/usr/bin/env bun
// OpenTF Web — CSR dev server (our orchestrator, ARCHITECTURE §8).
//
// Drives Rolldown (used as a library) to bundle the app: our Rust compiler runs
// as a Rolldown `transform` plugin (per .jsx/.tsx, via `otfw build --stdin`),
// Rolldown resolves/links the module graph (incl. `@opentf/web` + composed
// components), and Bun.serve serves the bundle with SSE live-reload on rebuild.
//
// Usage:  otfw-dev [route]   (default route: "counter")
//   → serves <cwd>/playground/app/<route>/page.jsx
//
// Run from the monorepo root (`bun run dev`): the project root is `process.cwd()`.

import { watch } from "rolldown";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = process.cwd();
const route = process.argv[2] ?? "counter";
const port = Number(process.env.PORT ?? 5175);

const pagePath = `${root}/playground/app/${route}/page.jsx`;
if (!existsSync(pagePath)) {
  console.error(`✗ no page at ${pagePath}`);
  process.exit(1);
}

// Ensure the compiler binary exists (build once).
const otfw = `${root}/target/debug/otfw`;
if (!existsSync(otfw)) {
  console.log("building compiler (cargo build -p otfw_cli)…");
  const b = Bun.spawnSync(["cargo", "build", "-p", "otfw_cli"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (b.exitCode !== 0) process.exit(b.exitCode);
}

// Generate the entry: import the page factory and mount it.
const devDir = `${root}/.dev`;
mkdirSync(`${devDir}/csr`, { recursive: true });
const entry = `${devDir}/entry.js`;
writeFileSync(
  entry,
  `import Page from ${JSON.stringify(pagePath)};\n` +
    `import { mount } from "@opentf/web";\n` +
    `mount(Page, document.getElementById("app"));\n`,
);

// Rolldown plugin: compile .jsx/.tsx through our Rust compiler.
const otfwPlugin = {
  name: "otfw",
  transform(code, id) {
    if (!/\.[jt]sx$/.test(id)) return null;
    const base = id
      .split("/")
      .pop()
      .replace(/\.[jt]sx$/, "");
    const isPage = base === "page" || base === "layout" || base === "404";
    const args = ["build"];
    if (!isPage) args.push("--component");
    args.push("--stdin", id);
    const proc = Bun.spawnSync([otfw, ...args], {
      stdin: new TextEncoder().encode(code),
    });
    if (proc.exitCode !== 0) {
      throw new Error(`otfw failed for ${id}:\n${proc.stderr.toString()}`);
    }
    // Side effects (e.g. customElements.define) must survive bundling.
    return { code: proc.stdout.toString(), moduleSideEffects: true };
  },
};

// Live-reload: SSE clients notified on each successful rebuild.
const clients = new Set();
function reload() {
  for (const c of clients) {
    try {
      c.enqueue("data: reload\n\n");
    } catch {
      clients.delete(c);
    }
  }
}

const watcher = watch({
  input: entry,
  resolve: {
    alias: { "@opentf/web": `${root}/packages/web/index.js` },
    extensions: [".jsx", ".tsx", ".js", ".ts"],
  },
  plugins: [otfwPlugin],
  output: { dir: `${devDir}/csr`, format: "esm", entryFileNames: "bundle.js" },
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

// The web root holds the project's index.html and static assets (css, public).
const webRoot = `${root}/${process.env.WEB_ROOT ?? "playground"}`;
const indexPath = `${webRoot}/index.html`;

// Snippets injected into the served HTML: our bundle + the live-reload client.
const injected =
  `<script type="module" src="/bundle.js"></script>\n` +
  `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>\n`;

// Use the project's index.html as the shell. We strip any Vite-style module
// entry scripts (`<script type="module" src=…>` — the app would be double-loaded)
// and inject our bundle + reload client before </body>. Non-module scripts
// (e.g. @babel/standalone) are left intact.
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
<title>OpenTF Web — /${route}</title></head><body><div id="app"></div></body></html>`;
  }
  return html.includes("</body>")
    ? html.replace("</body>", `${injected}</body>`)
    : html + injected;
}

const TYPES = {
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

// Serve a static file from the web root (no path traversal outside it).
function serveStatic(pathname) {
  const file = `${webRoot}${pathname}`;
  if (!file.startsWith(webRoot) || !existsSync(file)) return null;
  const ext = pathname.split(".").pop();
  return new Response(readFileSync(file), {
    headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
  });
}

Bun.serve({
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/bundle.js") {
      const f = `${devDir}/csr/bundle.js`;
      return new Response(existsSync(f) ? readFileSync(f) : "// building…", {
        headers: { "content-type": "text/javascript" },
      });
    }
    if (pathname === "/__reload") {
      return new Response(
        new ReadableStream({
          start(controller) {
            clients.add(controller);
            req.signal.addEventListener("abort", () =>
              clients.delete(controller),
            );
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        },
      );
    }
    // Static assets referenced by index.html (css, public/, etc).
    if (pathname !== "/") {
      const asset = serveStatic(pathname);
      if (asset) return asset;
      // A request that looks like a file (has an extension) but isn't found is a
      // genuine 404; extensionless paths fall through to the SPA shell.
      if (/\.[a-z0-9]+$/i.test(pathname)) {
        return new Response("not found", { status: 404 });
      }
    }
    // Everything else falls through to the HTML shell (SPA-style).
    return new Response(buildHtml(), {
      headers: { "content-type": "text/html" },
    });
  },
});

console.log(`\n  OpenTF Web CSR dev server`);
console.log(`  → http://localhost:${port}  (route: /${route})\n`);
