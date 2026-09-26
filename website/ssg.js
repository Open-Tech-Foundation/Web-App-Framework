// Native SSG step for `esdev build` (the `site-ssg` target, `"then": "run"`).
//
// Runs AFTER every target is built, in a child process. Its cwd is NOT a stable
// anchor (observed: the project root) — everything derives from this bundle's
// own path instead (see Anchor below).
//
// - SOURCES (app/, otfw.config.js, public/ overrides) live in the REAL tree —
//   staging mirrors outputs only. The repo root is found by walking up from this
//   bundle's own path to the first `package.json` (staging carries none).
// - OUTPUTS (the staged site) sit under the staging root — or the final output
//   when there is no staging (selected-target builds overlay in place).
//
// Everything else is the `otfw build --ssg` second half (`packages/web-cli`): the
// shell is the site target's own `index.html` output (bundle script + stylesheet
// already injected, assets already copied), stamped with the hydrate sentinel the
// declarative build doesn't know about.

import { env, exit } from "runtime:process";
import { basename, dirname, fromFileURL, join, toFileURL } from "runtime:path";

import { exists, findUp, readText, resolveFrom } from "../packages/web-cli/src/runtime.js";
import {
  assertNoRouteConflicts,
  closeCompilers,
  discoverLoaders,
  discoverPages,
  emitApiBundle,
  emitLoaderBundle,
  loadConfig,
  loadDocsPlugins,
  resolveCompiler,
  runBlogFeed,
  runDocsSearchIndex,
  runLastUpdated,
  runLlmsFiles,
  stampHydrateSentinel,
} from "../packages/web-cli/src/shared.js";
import { runPrerender } from "../packages/web-cli/src/prerender.js";
import { fmtMs, step } from "../packages/web-cli/src/reporter.js";

const t0 = performance.now();

// Anchor — everything derives from this bundle's own path, the one stable truth:
// under a full `esdev build` it is the STAGED copy (`<root>/.esdev-build-*/…`),
// otherwise the final output. Sources always live in the REAL tree (staging
// mirrors outputs only); the staged site is under the staging root when there
// is one, else the final output (selected-target builds overlay in place).
const bundleDir = dirname(fromFileURL(import.meta.url));
let stagingRoot = null;
for (let dir = bundleDir; ; ) {
  if (basename(dir).startsWith(".esdev-build-")) {
    stagingRoot = dir;
    break;
  }
  const up = dirname(dir);
  if (up === dir) break;
  dir = up;
}
const projectRoot = stagingRoot
  ? dirname(stagingRoot)
  : await findUp("package.json", bundleDir);
const root = join(projectRoot, "website");
const appDir = join(root, "app");
const stagedOut = stagingRoot ? join(stagingRoot, "website/dist-pure") : join(root, "dist-pure");
if (!projectRoot || !(await exists(appDir))) {
  console.error(`✗ ssg: cannot anchor sources (bundle at ${bundleDir})`);
  exit(1);
}

const shellPath = join(stagedOut, "index.html");
if (!(await exists(shellPath))) {
  console.error(
    `✗ ssg: no staged site at ${shellPath}\n` +
      `  Build the site target first (a full \`esdev build\` builds every target).`,
  );
  exit(1);
}

const exclude = new Set((env.EXCLUDE_ROUTES ?? "").split(",").filter(Boolean));
const config = await loadConfig(root);
const baseUrl = String(config?.site?.url ?? "").replace(/\/+$/, "");
if (!baseUrl && (config?.docs || config?.blog)) {
  console.error(
    `✗ site.url is required for this production build.\n` +
      `  Add it to website/otfw.config.js:\n\n` +
      `  export default defineDocsConfig({\n` +
      `    site: { url: "https://example.com" }\n` +
      `  })`,
  );
  exit(1);
}

const pages = await discoverPages(appDir, exclude);
if (pages.length === 0) {
  console.error(`✗ no page.jsx files found under ${appDir}`);
  exit(1);
}
await assertNoRouteConflicts(appDir, exclude);

const docsPlugins = await loadDocsPlugins(root, appDir, config, exclude);

// The site target composed this shell (bundle + stylesheet + assets); stamp the
// `#app` sentinel so the client adopts the server markup instead of rebuilding it.
const shellHtml = stampHydrateSentinel(await readText(shellPath));

const webEntry = await resolveFrom("@opentf/web", root).catch(() => {
  console.error(`✗ cannot resolve "@opentf/web" from ${root}`);
  exit(1);
});
const { otfwc } = await resolveCompiler();

// Route loaders run at build time (no `request`, empty query), so their bundle must
// precede the pre-render. The website has none today — this stays a no-op for it.
let loaders = null;
{
  const loaderFiles = await discoverLoaders(appDir, exclude);
  if (loaderFiles.length > 0) {
    const loaderStep = step("Bundling route loaders");
    await emitLoaderBundle({
      root,
      appDir,
      webEntry,
      exclude,
      i18n: config?.i18n,
      outDir: join(stagedOut, "server"),
    });
    loaders = (await import(toFileURL(join(stagedOut, "server", "loaders.js")).href)).loaders;
    loaderStep.done(`Route loaders — ${loaderFiles.length} → dist/server/loaders.js`);
  }
}

const lastUpdated = await runLastUpdated(root, appDir, config, exclude);
const ssgStep = step("Pre-rendering pages");
let ssgCompiled = 0;
// No route→chunk manifest: the declarative build emits one client bundle, so there
// are no per-route chunks to `modulepreload` (matches the CLI's CSR behavior).
const ssg = await runPrerender({
  root,
  pages,
  webEntry,
  otfwc,
  shellHtml,
  outDir: stagedOut,
  baseUrl,
  docsPlugins,
  lastUpdated,
  i18n: config?.i18n,
  loaders,
  chunkManifest: null,
  onCompile: (id) => ssgStep.update(`compiling ${id.split("/").pop()}  (${++ssgCompiled})`),
  onRender: (done, total) => ssgStep.update(`rendering ${done}/${total}`),
});
ssgStep.done(
  `Pre-rendered ${ssg.count} page(s)` +
    (ssg.skipped.length ? ` · ${ssg.skipped.length} dynamic route(s) skipped` : ""),
);

// API routes: emitted for a deploy adapter; null when the app has none (this site).
const apiStep = step("Bundling API routes");
const api = await emitApiBundle({
  root,
  appDir,
  webEntry,
  exclude,
  i18n: config?.i18n,
  outDir: join(stagedOut, "server"),
});
apiStep.done(
  api
    ? `API routes — ${api.routes.length}${api.middleware.length ? ` (+${api.middleware.length} middleware)` : ""} → dist/server/api.js`
    : "API routes — none",
);

// Docs search indexes the pre-rendered HTML above.
if (config?.docs?.search?.provider === "otf") {
  const searchStep = step("Building search index");
  const search = await runDocsSearchIndex(root, config, stagedOut, otfwc);
  searchStep.done(`Search index — ${search?.pages ?? 0} page(s)`);
}

if (config?.blog) {
  const feedStep = step("Generating blog feeds");
  const feed = await runBlogFeed(root, appDir, config, stagedOut, baseUrl, exclude);
  if (feed) feedStep.done(`Blog feeds — ${feed.count} post(s) → ${feed.paths.join(", ")}`);
  else feedStep.done("Blog feeds — skipped");
}

if (config?.docs || config?.blog) {
  const llmsStep = step("Generating LLM context");
  const llms = await runLlmsFiles(root, appDir, pages, config, stagedOut, baseUrl, {
    siteDescription: ssg.siteDescription,
  });
  if (llms) llmsStep.done(`LLM context — ${llms.paths.join(", ")}`);
  else llmsStep.done("LLM context — skipped");
}

// Stop the `otfwc serve` children: an open reader on a child's stdout keeps the
// runtime alive, so this is what lets a finished build actually exit.
await closeCompilers();

console.log(`\n  → dist-pure/  ready in ${fmtMs(performance.now() - t0)}\n`);
