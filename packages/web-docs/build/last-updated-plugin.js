// Build-time "last updated" map generator (a Rolldown plugin), sibling of the nav and
// blog-posts plugins. It walks every page under `app/`, resolves each one's last-updated
// time (git commit or frontmatter override — see last-updated.js), and resolves the
// virtual module `@opentf/web-docs/updated` to a `{ [routePath]: ISO }` map. Layouts look
// the current route up in that map to render a "Last updated" line — so every section
// gets it from one switch, no per-section config.
//
// The same map is needed by the SSG step for the `article:modified_time` SEO tag, so
// the scan is exposed as a callable (`loadLastUpdated`) too.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { readFrontmatter } from "./frontmatter.js";
import { resolveLastUpdated } from "./last-updated.js";

const VIRTUAL_ID = "@opentf/web-docs/updated";
const RESOLVED_ID = "\0otfw-last-updated";
const PAGE_RE = /^page\.(mdx|md|[jt]sx)$/;
const MD_RE = /\.(mdx|md)$/;

/**
 * @param {Object} opts
 * @param {string} opts.appDir
 * @param {Set<string>} [opts.exclude] Folder names to skip (mirrors route exclusions).
 */
export function lastUpdatedPlugin({ appDir, exclude = new Set() } = {}) {
  return {
    name: "otfw-last-updated",
    resolveId(source) {
      return source === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const watch = [];
      const { updated, editPaths } = collect(appDir, exclude, watch);
      for (const f of watch) this.addWatchFile?.(f);
      // Default export: the `{ route: ISO }` last-updated map. Named `editPaths`:
      // `{ route: repo-relative-file }`, for building "Edit this page" links.
      return (
        `export default ${JSON.stringify(updated)};\n` +
        `export const editPaths = ${JSON.stringify(editPaths)};\n`
      );
    },
  };
}

/**
 * The `{ [routePath]: ISO }` last-updated map, callable directly (used by the SSG SEO
 * step). Mirrors what the virtual module exposes.
 */
export function loadLastUpdated({ appDir, exclude = new Set() } = {}) {
  return collect(appDir, exclude, []).updated;
}

/** Git repo root containing `dir`, or null (so edit links degrade gracefully). */
function gitRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function collect(appDir, exclude, watch) {
  const updated = {};
  const editPaths = {};
  const root0 = gitRoot(appDir);
  // One walk over every page under app/ — covers all sections (and the home page).
  walk(appDir, "", exclude, (file, route) => {
    watch.push(file);
    const fm = MD_RE.test(file) ? readFrontmatter(file) : {};
    const iso = resolveLastUpdated(file, fm.lastUpdated);
    if (iso) updated[route] = iso;
    // Repo-relative path (POSIX separators) for the "Edit this page" link.
    if (root0) editPaths[route] = relative(root0, file).split(/[\\/]/).join("/");
  });
  return { updated, editPaths };
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
