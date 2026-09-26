// Stable SSG surface for `then: "run"` prerender steps (`website/ssg.js`).
//
// A prerender bundle must import ONE specifier that resolves identically whether
// the site builds inside this monorepo (workspace symlink) or standalone from
// npm (a Cloudflare `website/` root directory): `@opentf/web-cli/ssg`. Reaching
// into `./src/shared.js` relatively would only work in the monorepo, and the
// package's `exports` map would block the bare subpath — so this module is the
// curated re-export. When these helpers move to `@opentf/esdev-plugin-web`,
// only this file changes; consumers stay untouched.

export { exists, findUp, readText, resolveFrom } from "./runtime.js";
export {
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
} from "./shared.js";
export { runPrerender } from "./prerender.js";
export { fmtMs, step } from "./reporter.js";
