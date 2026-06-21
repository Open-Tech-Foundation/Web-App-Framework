// SSG pre-render (Phase 1): build a server bundle of the app, run it in a linkedom
// DOM, and render each route to a static HTML file (SPEC §9). Invoked by `otfw
// build --ssg` after the client bundle + shell HTML are ready.
//
// Reactivity stays a client concern: `globalThis.__OTFW_SSG__` makes the signals
// core run each binding once (initial markup) without retaining the reactive graph.
// The client bundle still mounts on load and re-renders into #app (no hydration in
// Phase 1 — that's Phase 2), so SSG here is for SEO / first paint.

import { build } from "rolldown";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseHTML } from "linkedom";
import { EXTENSIONS, cssPlugin, otfwPlugin } from "./shared.js";

// Generated server entry: eager-import every page module so registerRoutes sees
// real namespaces (enabling getStaticPaths), and re-export the server render API.
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

// Install a linkedom DOM as globals so the app's Custom Elements register and
// connect, and the runtime's `typeof window` checks see a browser-like env.
function installDom(shellHtml) {
  const dom = parseHTML(shellHtml || "<!doctype html><html><head></head><body></body></html>");
  const { window, document, customElements, HTMLElement } = dom;
  // router.js reads window.location.pathname at module init; provide a default.
  if (!window.location) {
    try {
      window.location = { pathname: "/", search: "", origin: "http://localhost", href: "http://localhost/" };
    } catch {
      Object.defineProperty(window, "location", {
        value: { pathname: "/", search: "", origin: "http://localhost" },
        configurable: true,
      });
    }
  }
  Object.assign(globalThis, {
    window,
    document,
    customElements,
    HTMLElement,
    Node: window.Node,
    CustomEvent: window.CustomEvent,
    __OTFW_SSG__: true,
  });
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
 * `{ count, skipped }`.
 */
export async function runPrerender({ root, pages, webEntry, otfwc, shellHtml, outDir }) {
  const tmp = join(root, ".otfw-ssg");
  mkdirSync(tmp, { recursive: true });
  const entry = join(tmp, "ssg-entry.js");
  writeFileSync(entry, serverEntrySource(pages));

  // A non-minified, server-side bundle of the app + render API.
  const serverRender = join(dirname(webEntry), "server", "render.js");
  await build({
    input: entry,
    resolve: {
      alias: { "@opentf/web/server": serverRender, "@opentf/web": webEntry },
      extensions: EXTENSIONS,
    },
    plugins: [otfwPlugin(otfwc, { failOnError: true }), cssPlugin()],
    output: { dir: join(tmp, "out"), format: "esm", entryFileNames: "server.js" },
  });

  installDom(shellHtml);
  const mod = await import(pathToFileURL(join(tmp, "out", "server.js")).href);

  const { paths, skipped } = await mod.collectRoutePaths();
  for (const route of paths) {
    const markup = (await mod.renderToString(route)) ?? "";
    const file = htmlPathFor(outDir, route);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, injectMarkup(shellHtml, markup));
  }

  // 404: any unmatched path resolves to the registered 404 page.
  const notFound = await mod.renderToString("/__otfw_404__");
  if (notFound != null) writeFileSync(join(outDir, "404.html"), injectMarkup(shellHtml, notFound));

  rmSync(tmp, { recursive: true, force: true });
  return { count: paths.length, skipped };
}
