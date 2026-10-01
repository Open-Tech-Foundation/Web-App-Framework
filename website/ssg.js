// Native SSG step for `esdev build` (the `site-ssg` target, `"then": "run"`).
//
// Runs AFTER every target is built, in a child process. Its cwd is NOT a stable
// anchor (observed: the project root) — everything derives from this bundle's
// own path instead (see Anchor below).
//
// - SOURCES (app/, otfw.config.js, public/ overrides) live in the REAL tree —
//   staging mirrors outputs only. The source project is the staging directory's
//   parent.
// - OUTPUTS (the staged site) sit under the staging root. No staging area (the
//   dev loop runs the bundle straight from the `.dev` mirror) means "not a
//   release build" — the step skips rather than touch the final tree (see below).
//
// The site owns its esdev.json and installed packages. Its project root is
// always `website/`, including when copied for a standalone deploy.
//
// Everything else is the `otfw build --ssg` second half: the shell is the site
// target's own `index.html` output (bundle script + stylesheet already injected,
// assets already copied), stamped with the hydrate sentinel the declarative
// build doesn't know about.

import { env, exit } from "runtime:process";
import { realPath } from "runtime:fs";
import { basename, dirname, fromFileURL, join, toFileURL } from "runtime:path";

const t0 = performance.now();

// The dev loop (`esdev start`) builds this bundle too — but it must never run
// there: start skips this target by default; explicitly watching it has no staging (the bundle runs straight from the `.dev` mirror),
// so the outputs below would land in the FINAL tree, clobbering the release
// deployment with dev-profile HTML — and the step only reruns when this bundle's
// own files change, so page edits would serve stale routes anyway (observed).
// Prerender on staged release builds only (full `esdev build`); dev serves the
// live CSR shell (HMR-correct, like the old CLI dev), `esdev preview` shows the
// release output. No signal needed beyond the staging root itself: no
// `.esdev-build-*` ancestor means "not a release build", in any devdir, and the
// safe direction is to skip.

// Anchor — everything derives from this bundle's own path, the one stable truth:
// under a full `esdev build` it is the STAGED copy (`<root>/.esdev-build-*/…`),
// otherwise the final output. Sources always live in the REAL tree (staging
// mirrors outputs only); the staged site is under the staging root when there
// is one, else the final output (selected-target builds overlay in place).
const bundlePath = fromFileURL(import.meta.url).replace(/\\/g, "/");
const bundleDir = dirname(bundlePath);
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
if (!stagingRoot) {
  console.log("ssg: no staging area — prerender runs on a release `esdev build`, skipping.");
  exit(0);
}
// Keep package-relative binary paths intact: load installed tooling at runtime.
// A computed import keeps esdev from inlining its import.meta.url into this bundle.
const ssgModule = ["@opentf", "web-cli", "ssg"].join("/");
const {
  assertNoRouteConflicts,
  closeCompilers,
  discoverLoaders,
  discoverPages,
  emitApiBundle,
  emitLoaderBundle,
  exists,
  fmtMs,
  loadConfig,
  loadDocsPlugins,
  readText,
  resolveCompiler,
  resolveFrom,
  runLastUpdated,
  runPrerender,
  stampHydrateSentinel,
  step,
  writePrerenderReport,
} = await import(ssgModule);

const root = dirname(stagingRoot);
const outName = "dist";
const appDir = join(root, "app");
const stagedOut = join(stagingRoot, outName);
if (!(await exists(appDir))) {
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
      `  Add it to otfw.config.js:\n\n` +
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

// Use the same canonical package path as the bundler's package resolver; pnpm
// symlink paths otherwise create separate router instances in the server bundle.
const webEntry = await resolveFrom("@opentf/web", root).then(realPath).catch(() => {
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
if (!ssg.count || ssg.failed.length) {
  await closeCompilers();
  throw new Error(`Site prerender failed: ${ssg.count} page(s) rendered, ${ssg.failed.length} failed`);
}
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

// The finish plugin consumes this handoff and generates search, feeds and LLM files.
await writePrerenderReport(stagedOut, ssg);

// Stop the `otfwc serve` children: an open reader on a child's stdout keeps the
// runtime alive, so this is what lets a finished build actually exit.
await closeCompilers();

console.log(`\n  → ${outName}/  prerendered in ${fmtMs(performance.now() - t0)}\n`);
