// Build-time "last updated" map generator (a Rolldown plugin), sibling of the nav and
// blog-posts plugins. It walks the configured docs/blog folders, resolves each page's
// last-updated time (git commit or frontmatter override — see last-updated.js), and
// resolves the virtual module `@opentf/web-docs/updated` to a `{ [routePath]: ISO }`
// map. Layouts look the current route up in that map to render a "Last updated" line.
//
// The same map is needed by the SSG step for the `article:modified_time` SEO tag, so
// the scan is exposed as a callable (`loadLastUpdated`) too.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readFrontmatter } from "./frontmatter.js";
import { resolveLastUpdated } from "./last-updated.js";

const VIRTUAL_ID = "@opentf/web-docs/updated";
const RESOLVED_ID = "\0otfw-last-updated";
const PAGE_RE = /^page\.(mdx|md|[jt]sx)$/;
const MD_RE = /\.(mdx|md)$/;

/**
 * @param {Object} opts
 * @param {string} opts.appDir
 * @param {Array<{dir: string}>} opts.sections  Content roots to scan, e.g.
 *   `[{ dir: "docs" }, { dir: "blog" }]`. A `dir` of "." / "" means the app root.
 * @param {Set<string>} [opts.exclude]
 */
export function lastUpdatedPlugin({ appDir, sections = [], exclude = new Set() } = {}) {
  return {
    name: "otfw-last-updated",
    resolveId(source) {
      return source === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const watch = [];
      const map = collect(appDir, sections, exclude, watch);
      for (const f of watch) this.addWatchFile?.(f);
      return `export default ${JSON.stringify(map)};\n`;
    },
  };
}

/**
 * The `{ [routePath]: ISO }` last-updated map, callable directly (used by the SSG SEO
 * step). Mirrors what the virtual module exposes.
 */
export function loadLastUpdated({ appDir, sections = [], exclude = new Set() } = {}) {
  return collect(appDir, sections, exclude, []);
}

function collect(appDir, sections, exclude, watch) {
  const map = {};
  for (const { dir } of sections) {
    const atRoot = dir === "." || dir === "";
    const root = atRoot ? appDir : join(appDir, dir);
    const base = atRoot ? "" : "/" + dir;
    if (!existsSync(root)) continue;
    walk(root, base, exclude, (file, route) => {
      watch.push(file);
      const fm = MD_RE.test(file) ? readFrontmatter(file) : {};
      const iso = resolveLastUpdated(file, fm.lastUpdated);
      if (iso) map[route] = iso;
    });
  }
  return map;
}

/** Recursively find every `page.*` under `root`, mapping it to its route path. */
function walk(dir, route, exclude, onPage) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || exclude.has(entry.name)) {
        continue;
      }
      walk(join(dir, entry.name), `${route}/${entry.name}`, exclude, onPage);
    } else if (PAGE_RE.test(entry.name)) {
      onPage(join(dir, entry.name), route || "/");
    }
  }
}
