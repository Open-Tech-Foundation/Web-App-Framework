// Build-time navigation generator (a Rolldown plugin).
//
// The sidebar / breadcrumbs / prev-next need the whole documentation tree, which
// only exists on disk at build time. This plugin scans `app/<dir>` for routes,
// reads each folder's `_meta.{js,json}` for ordering + labels and each page's
// frontmatter for titles, and resolves `@opentf/web-docs/nav` to a generated module
// exporting the ordered tree. It is a pure build-time *consumer* of the file tree
// (ARCHITECTURE.md §6) — no new compiler stage, no runtime cost.
//
// Tree node shape: `{ title, path?, order?, items?: Node[] }`. A node with `path`
// is a link; a node with `items` is a (possibly also linked) group.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { readFrontmatter } from "./frontmatter.js";

const PAGE_RE = /^page\.(mdx|md|[jt]sx)$/;
const MD_RE = /\.(mdx|md)$/;

/**
 * @param {Object} opts
 * @param {string} opts.appDir      Absolute path to the project's `app/` directory.
 * @param {string} [opts.contentDir] Docs content folder under app/ (default "docs").
 * @param {Set<string>} [opts.exclude] Folder names to skip (mirrors route exclusions).
 * @param {string} [opts.virtualId] The virtual specifier this instance resolves
 *                            (default `@opentf/web-docs/nav`). A second instance can
 *                            generate an independent nav tree (e.g. an `/api` section)
 *                            under a different id like `@opentf/web-docs/nav-api`.
 */
export function docsNavPlugin({
  appDir,
  contentDir = "docs",
  exclude = new Set(),
  virtualId = "@opentf/web-docs/nav",
} = {}) {
  // `"."`/`""` means the docs live at the app root (routes at "/"); otherwise they
  // live in app/<contentDir> (routes under "/<contentDir>").
  const atRoot = contentDir === "." || contentDir === "";
  const root = atRoot ? appDir : join(appDir, contentDir);
  const base = atRoot ? "" : "/" + contentDir;
  const resolvedId = "\0otfw-docs-nav:" + virtualId;
  return {
    name: "otfw-docs-nav:" + contentDir,
    resolveId(source) {
      if (source === virtualId) return resolvedId;
      return null;
    },
    async load(id) {
      if (id !== resolvedId) return null;
      const watch = [];
      const tree = existsSync(root) ? await buildSection(root, base, watch, true, exclude) : [];
      // Rebuild on changes to meta/page files during `otfw dev`.
      for (const f of watch) this.addWatchFile?.(f);
      return `export default ${JSON.stringify(tree)};\n`;
    },
  };
}

/** Load a folder's `_meta` (ordering + labels). Supports `.js`/`.mjs`/`.json`. */
async function loadMeta(dir, watch) {
  for (const name of ["_meta.js", "_meta.mjs", "_meta.json"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    watch.push(p);
    try {
      if (name.endsWith(".json")) return JSON.parse(readFileSync(p, "utf8"));
      // Cache-bust so `otfw dev` picks up edits.
      const mod = await import(pathToFileURL(p).href + `?t=${Date.now()}`);
      return mod.default ?? mod;
    } catch (e) {
      console.warn(`⚠ [@opentf/web-docs] could not load ${p}: ${e?.message ?? e}`);
    }
    return null;
  }
  return null;
}

/** The `page.*` file directly in `dir`, or null. */
function pageFile(dir) {
  for (const name of readdirSync(dir)) {
    if (PAGE_RE.test(name)) return join(dir, name);
  }
  return null;
}

function humanize(seg) {
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Order child keys: those named in `_meta` first (in declared order), rest A→Z. */
function orderKeys(keys, meta) {
  if (!meta) return keys.slice().sort();
  const metaKeys = Array.isArray(meta) ? meta : Object.keys(meta);
  const named = metaKeys.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !metaKeys.includes(k)).sort();
  return [...named, ...rest];
}

/** A label declared in `_meta` for `key`, or null. */
function metaLabel(meta, key) {
  if (!meta || Array.isArray(meta)) return null;
  const v = meta[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.title ?? v.label ?? null;
  return null;
}

/**
 * Build the ordered items of a section directory. Each subdirectory becomes a child
 * node (a link and/or a group). At the docs root (`withIndex`), the root's own
 * `page.*` is emitted as a standalone "Overview"-style entry; in nested groups the
 * folder's own page is the group node's link (added by `buildNode`), so it is not
 * repeated here. Order + labels come from `_meta`.
 */
async function buildSection(dir, route, watch, withIndex = false, exclude = new Set()) {
  const meta = await loadMeta(dir, watch);
  const entries = readdirSync(dir, { withFileTypes: true });
  const subdirs = entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !e.name.startsWith("_") &&
        !exclude.has(e.name),
    )
    .map((e) => e.name);

  const items = [];

  // The docs root's own landing page (e.g. app/docs/page.mdx → /docs).
  const indexFile = withIndex ? pageFile(dir) : null;
  const keys = subdirs.slice();
  if (indexFile) keys.unshift("index");

  let ordered = orderKeys(keys, meta);
  // Default the landing page to the top unless `_meta` orders it.
  const metaOrdersIndex = meta && !Array.isArray(meta) && "index" in meta;
  if (indexFile && !metaOrdersIndex) {
    ordered = ["index", ...ordered.filter((k) => k !== "index")];
  }

  for (const key of ordered) {
    if (key === "index") {
      watch.push(indexFile);
      const fm = MD_RE.test(indexFile) ? readFrontmatter(indexFile) : {};
      items.push(
        clean({
          title: metaLabel(meta, "index") ?? fm.sidebar_label ?? fm.title ?? "Overview",
          path: route || "/",
          order: fm.order,
        }),
      );
      continue;
    }
    const node = await buildNode(join(dir, key), `${route}/${key}`, key, meta, watch, exclude);
    if (node) items.push(node);
  }
  return items;
}

/** Build a single subdirectory node: its own link (if it has a page) + children. */
async function buildNode(dir, route, key, parentMeta, watch, exclude) {
  const pf = pageFile(dir);
  let fm = {};
  if (pf) {
    watch.push(pf);
    if (MD_RE.test(pf)) fm = readFrontmatter(pf);
  }
  const children = await buildSection(dir, route, watch, false, exclude);
  // A directory that has neither a page nor children contributes nothing.
  if (!pf && children.length === 0) return null;

  const title = metaLabel(parentMeta, key) ?? fm.sidebar_label ?? fm.title ?? humanize(key);
  return clean({
    title,
    path: pf ? route : undefined,
    order: fm.order,
    items: children.length ? children : undefined,
  });
}

/** Drop undefined fields so the emitted JSON stays small. */
function clean(node) {
  for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
  return node;
}
