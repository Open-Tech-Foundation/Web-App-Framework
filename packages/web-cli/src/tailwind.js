// Tailwind CSS v4 compilation.
//
// We drive Tailwind's engine directly. `tailwindcss` itself is pure JavaScript with no
// dependencies — the whole utility engine, `@theme`, variants and `@apply` — so it runs
// here unchanged. What does *not* run here is the two packages that wrap it for Node:
// `@tailwindcss/node` (module resolution for `@import`, config loading, minification)
// and `@tailwindcss/oxide` (the source scanner), both of which are native addons.
//
// Tailwind exposes exactly the seams needed to replace them: `compile()` takes
// `loadStylesheet`/`loadModule` callbacks, and `build()` takes the candidate list a
// scanner would have produced. So this file is those two shims and nothing else.

import { compile } from "tailwindcss";
import { dirname, extname, join } from "runtime:path";

import { packageDir, readEntries, readText, resolveFrom, throughExports } from "./runtime.js";

// A stylesheet uses Tailwind if it pulls in the framework (v4 `@import
// "tailwindcss"`) or any legacy `@tailwind` directive. Plain CSS is served as-is.
export function usesTailwind(source) {
  return /@import\s+["']tailwindcss["']|@tailwind\b/.test(source);
}

// --------------------------------------------------------------- resolution shims

/**
 * Resolve an `@import` target. Relative ids join against the importing sheet; a bare
 * one goes through its package's `exports` map (`@import "@opentf/web-docs/theme"` →
 * `theme/index.css`), preferring the `style` condition as a CSS resolver should.
 */
function makeLoadStylesheet(root) {
  return async function loadStylesheet(id, base) {
    let path;
    if (id.startsWith(".") || id.startsWith("/")) {
      path = join(base, id);
    } else {
      const m = /^((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/.exec(id);
      const dir = await packageDir(m[1], root);
      const sub = m[2] ? `./${m[2]}` : ".";
      let target = null;
      try {
        const manifest = JSON.parse(await readText(join(dir, "package.json")));
        target = throughExports(manifest.exports, sub, ["style", "import", "default"]);
      } catch {}
      // Tailwind's own entry is `index.css`; a package with no matching export falls
      // back to the literal subpath, given `.css` when it carries no extension.
      path = join(dir, target ?? (m[2] ? (extname(m[2]) ? m[2] : `${m[2]}.css`) : "index.css"));
    }
    return { path, base: dirname(path), content: await readText(path) };
  };
}

/** Resolve an `@plugin` / `@config` target to its module. */
function makeLoadModule(root) {
  return async function loadModule(id, base) {
    const path = id.startsWith(".") ? join(base, id) : await resolveFrom(id, root);
    const mod = await import(path);
    return { path, base: dirname(path), module: mod.default ?? mod };
  };
}

// ------------------------------------------------------------------- the scanner
//
// `@tailwindcss/oxide` exists to answer one question — which utility candidates appear
// anywhere in the project — and over-answering it is free: `build()` silently drops
// every candidate that is not a real utility, so a permissive extractor can only cost
// build time. Under-extracting would lose a class, so the regex errs wide.

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "target", "coverage",
  ".dev", ".otfw", ".otfw-ssg", ".otfw-api", ".otfw-api-build", ".otfw-loaders", ".otfw-loaders-build",
]);
const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".wasm", ".mp4", ".webm",
  ".zip", ".gz", ".pdf", ".lock", ".map", ".node",
]);
// A candidate is either a token containing an arbitrary value (`grid-cols-[1fr_2fr]`,
// `bg-[#fff]/50`) or a plain utility-shaped word, optionally variant-prefixed
// (`md:hover:bg-blue-600`, `-mt-2`, `!flex`).
const CANDIDATE_RE =
  /[^\s"'`<>=(){};,\\]*\[[^\s"'`\]]*\][^\s"'`<>=(){};,\\]*|[a-zA-Z@!-][a-zA-Z0-9@!:._/-]*/g;
// Files big enough to be generated output aren't hand-written class names.
const MAX_SCAN_BYTES = 2_000_000;

async function* walkFiles(dir) {
  for (const entry of await readEntries(dir)) {
    if (entry.isDir) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      yield* walkFiles(join(dir, entry.name));
    } else if (entry.isFile && !SKIP_EXTS.has(extname(entry.name).toLowerCase())) {
      yield join(dir, entry.name);
    }
  }
}

/** Every utility candidate appearing under the non-negated `sources`. */
async function scanCandidates(sources) {
  const roots = sources.filter((s) => !s.negated).map((s) => s.base);
  const denied = sources.filter((s) => s.negated).map((s) => s.base);
  const out = new Set();
  const seen = new Set();
  for (const root of roots) {
    for await (const path of walkFiles(root)) {
      if (seen.has(path)) continue;
      seen.add(path);
      if (denied.some((d) => path.startsWith(d))) continue;
      let text;
      try {
        text = await readText(path);
      } catch {
        continue; // unreadable or not UTF-8 — nothing to extract
      }
      if (text.length > MAX_SCAN_BYTES) continue;
      for (const m of text.matchAll(CANDIDATE_RE)) out.add(m[0]);
    }
  }
  return [...out];
}

/**
 * Compile a Tailwind entry stylesheet to plain CSS, scanning `base` (the project
 * root) for the utility classes actually used.
 *
 * @param {string} cssPath  absolute path to the entry `.css`
 * @param {string} source   its contents
 * @param {string} base     project root to scan for class-name candidates
 * @returns {Promise<string>} the generated CSS
 */
export async function compileCss(cssPath, source, base) {
  const compiler = await compile(source, {
    base: dirname(cssPath),
    loadStylesheet: makeLoadStylesheet(base),
    loadModule: makeLoadModule(base),
  });
  // Decide what to scan: `source(none)` disables scanning, `source(dir)` narrows
  // it, otherwise scan the whole project root. Always include the compiler's own
  // declared sources.
  const roots =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const sources = roots.concat(compiler.sources);
  return compiler.build(sources.length ? await scanCandidates(sources) : []);
}
