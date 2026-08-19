// Build-time "last updated" map generator (a bundler plugin), sibling of the nav and
// blog-posts plugins. It walks every page under `app/`, resolves each one's last-updated
// time (git commit or frontmatter override — see last-updated.js), and resolves the
// virtual module `@opentf/web-docs/updated` to a `{ [routePath]: ISO }` map. Layouts look
// the current route up in that map to render a "Last updated" line — so every section
// gets it from one switch, no per-section config.
//
// The same map is needed by the SSG step for the `article:modified_time` SEO tag, so
// the scan is exposed as a callable (`loadLastUpdated`) too.

import { join, relative } from "runtime:path";

import { readEntries, runOut } from "./host.js";
import { readFrontmatter } from "./frontmatter.js";
import { resolveLastUpdated } from "./last-updated.js";

const VIRTUAL_ID = "@opentf/web-docs/updated";
// No NUL sentinel: the bundler marks a module virtual explicitly, and a `\0` in
// a hook filter is an invalid regex — which silently matches *everything*.
const RESOLVED_ID = "otfw-virtual:otfw-last-updated";
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
    resolve: {
      filter: { id: VIRTUAL_ID },
      handler: (source) => (source === VIRTUAL_ID ? { id: RESOLVED_ID, virtual: true } : null),
    },
    load: {
      filter: { id: RESOLVED_ID },
      async handler(id) {
        if (id !== RESOLVED_ID) return null;
        const watch = [];
        const { updated, editPaths } = await collect(appDir, exclude, watch);
        // Default export: the `{ route: ISO }` last-updated map. Named `editPaths`:
        // `{ route: repo-relative-file }`, for building "Edit this page" links.
        return {
          code:
            `export default ${JSON.stringify(updated)};\n` +
            `export const editPaths = ${JSON.stringify(editPaths)};\n`,
          dependsOn: watch,
        };
      },
    },
  };
}

/**
 * The `{ [routePath]: ISO }` last-updated map, callable directly (used by the SSG SEO
 * step). Mirrors what the virtual module exposes.
 */
export async function loadLastUpdated({ appDir, exclude = new Set() } = {}) {
  return (await collect(appDir, exclude, [])).updated;
}

/** Git repo root containing `dir`, or null (so edit links degrade gracefully). */
const gitRoot = (dir) => runOut("git", ["rev-parse", "--show-toplevel"], dir);

async function collect(appDir, exclude, watch) {
  const updated = {};
  const editPaths = {};
  const root0 = await gitRoot(appDir);
  // One walk over every page under app/ — covers all sections (and the home page).
  await walk(appDir, "", exclude, async (file, route) => {
    watch.push(file);
    const fm = MD_RE.test(file) ? await readFrontmatter(file) : {};
    const iso = await resolveLastUpdated(file, fm.lastUpdated);
    if (iso) updated[route] = iso;
    // Repo-relative path (POSIX separators) for the "Edit this page" link.
    if (root0) editPaths[route] = relative(root0, file).split(/[\\/]/).join("/");
  });
  return { updated, editPaths };
}

/** Recursively find every `page.*` under `root`, mapping it to its route path. */
async function walk(dir, route, exclude, onPage) {
  for (const entry of await readEntries(dir)) {
    if (entry.isDir) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || exclude.has(entry.name)) {
        continue;
      }
      await walk(join(dir, entry.name), `${route}/${entry.name}`, exclude, onPage);
    } else if (PAGE_RE.test(entry.name)) {
      await onPage(join(dir, entry.name), route || "/");
    }
  }
}
