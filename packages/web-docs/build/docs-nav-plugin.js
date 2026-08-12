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

const VIRTUAL_ID = "@opentf/web-docs/nav";
const RESOLVED_ID = "\0otfw-docs-nav";
const PAGE_RE = /^page\.(mdx|md|[jt]sx)$/;
const MD_RE = /\.(mdx|md)$/;

/**
 * Generates `@opentf/web-docs/nav` as a **section map** — `{ "/<dir>": tree }`, one entry
 * per top-level folder under `app/`. Each folder is a potential `DocsLayout` section; the
 * layout selects its own subtree by the current route, so any number of sections (`/docs`,
 * `/api`, …) "just work" with no config — drop a folder in and give it a `DocsLayout`.
 *
 * @param {Object} opts
 * @param {string} opts.appDir       Absolute path to the project's `app/` directory.
 * @param {Set<string>} [opts.exclude] Folder names to skip (mirrors route exclusions).
 * @param {(file: string) => Promise<any>} [opts.importModule] How to read a `_meta.js`.
 *   The dev server passes a loader that re-evaluates the file after an edit; a plain
 *   `import()` cannot, because the runtime caches ESM by path for the process's life.
 */
export function docsNavPlugin({ appDir, exclude = new Set(), importModule } = {}) {
  return {
    name: "otfw-docs-nav",
    resolveId(source) {
      if (source === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      const ctx = { watch: [], importModule };
      const out = {};
      for (const entry of readdirSync(appDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name.startsWith("_") || exclude.has(entry.name)) {
          continue;
        }
        const base = "/" + entry.name;
        out[base] = await buildSection(join(appDir, entry.name), base, ctx, true, exclude);
      }
      // The files this tree was generated from. They are not imports, so nothing else
      // ties them to this module — declaring them is what makes `otfw dev` rebuild the
      // chunk holding the sidebar when a page's frontmatter or a `_meta.*` changes.
      for (const f of ctx.watch) this.addWatchFile?.(f);
      return `export default ${JSON.stringify(out)};\n`;
    },
  };
}

/** Load a folder's `_meta` (ordering + labels). Supports `.js`/`.mjs`/`.json`. */
async function loadMeta(dir, ctx) {
  for (const name of ["_meta.js", "_meta.mjs", "_meta.json"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    ctx.watch.push(p);
    try {
      if (name.endsWith(".json")) return JSON.parse(readFileSync(p, "utf8"));
      // A query string does not bust the ESM cache (Bun keys it by path and ignores
      // `?t=`), so under `otfw dev` the toolchain supplies a loader that can actually
      // re-read the file; without one this is a plain, once-per-process import.
      const mod = await (ctx.importModule?.(p) ?? import(pathToFileURL(p).href));
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
async function buildSection(dir, route, ctx, withIndex = false, exclude = new Set()) {
  const meta = await loadMeta(dir, ctx);
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
      ctx.watch.push(indexFile);
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
    const node = await buildNode(join(dir, key), `${route}/${key}`, key, meta, ctx, exclude);
    if (node) items.push(node);
  }
  return items;
}

/** Build a single subdirectory node: its own link (if it has a page) + children. */
async function buildNode(dir, route, key, parentMeta, ctx, exclude) {
  const pf = pageFile(dir);
  let fm = {};
  if (pf) {
    ctx.watch.push(pf);
    if (MD_RE.test(pf)) fm = readFrontmatter(pf);
  }
  const children = await buildSection(dir, route, ctx, false, exclude);
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
