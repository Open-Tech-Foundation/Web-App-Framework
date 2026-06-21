// SSG pre-render (ARCHITECTURE.md §6): build a *server* bundle of the app with the
// compiler's SSG backend (HTML-string renderers), then run it in plain Bun to
// render each route to a static HTML file. No DOM — the SSG output is pure string
// concatenation, so no effects/lifecycle run.

import { build } from "rolldown";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    `export { renderToString, collectRoutePaths } from "@opentf/web/server";\n` +
    `registerRoutes({\n${map}\n});\n`
  );
}

// Inject pre-rendered markup into the shell's #app container.
function injectMarkup(shellHtml, markup) {
  return shellHtml.replace(/(<div id="app"[^>]*>)\s*(<\/div>)/, `$1${markup}$2`);
}

// "/" → dist/index.html, "/post/1" → dist/post/1/index.html.
function htmlPathFor(outDir, route) {
  return route === "/" ? join(outDir, "index.html") : join(outDir, route, "index.html");
}

/**
 * Pre-render the app to static HTML files under `outDir`. Returns
 * `{ count, skipped, failed }`.
 */
export async function runPrerender({ root, pages, webEntry, otfwc, shellHtml, outDir }) {
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
    plugins: [otfwPlugin(otfwc, { failOnError: true, target: "ssg" }), cssPlugin()],
    output: { dir: join(tmp, "out"), format: "esm", entryFileNames: "server.js" },
  });

  // The runtime defines `class … extends HTMLElement` at load (for CSR custom
  // elements). SSG never instantiates them, but the base class must exist so the
  // class definitions evaluate. A bare stub suffices — no DOM (customElements
  // stays undefined, so the elements self-register only in the browser).
  globalThis.HTMLElement ??= class {};
  const mod = await import(pathToFileURL(join(tmp, "out", "server.js")).href);

  const { paths, skipped } = await mod.collectRoutePaths();
  const failed = [];
  for (const route of paths) {
    try {
      const markup = (await mod.renderToString(route)) ?? "";
      const file = htmlPathFor(outDir, route);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, injectMarkup(shellHtml, markup));
    } catch (e) {
      failed.push(route);
      console.error(`✗ pre-render failed for ${route}: ${e?.message ?? e}`);
    }
  }

  // 404: any unmatched path resolves to the registered 404 page.
  try {
    const notFound = await mod.renderToString("/__otfw_404__");
    if (notFound != null) writeFileSync(join(outDir, "404.html"), injectMarkup(shellHtml, notFound));
  } catch {
    /* no 404 page */
  }

  rmSync(tmp, { recursive: true, force: true });
  return { count: paths.length - failed.length, skipped, failed };
}
