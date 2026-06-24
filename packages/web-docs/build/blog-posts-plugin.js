// Build-time blog post index generator (a Rolldown plugin), the blog counterpart of
// docs-nav-plugin.js. It scans `app/<dir>` for post folders (`<slug>/page.{mdx,md}`),
// reads each post's frontmatter + computes its reading time, and resolves the virtual
// module `@opentf/web-docs/posts` to the ordered post list. A pure build-time
// consumer of the file tree — no compiler stage, no runtime cost.
//
// Post shape: `{ slug, path, title, description?, date?, author?, tags?, readingTime,
// order? }`. Sorted newest-first by `date`; a numeric `order` (frontmatter) overrides.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readFrontmatter } from "./frontmatter.js";
import { readingTime } from "./reading-time.js";

const VIRTUAL_ID = "@opentf/web-docs/posts";
const RESOLVED_ID = "\0otfw-blog-posts";
const PAGE_RE = /^page\.(mdx|md)$/;

/**
 * @param {Object} opts
 * @param {string} opts.appDir       Absolute path to the project's `app/` directory.
 * @param {string} [opts.contentDir] Blog content folder under app/ (default "blog").
 * @param {Set<string>} [opts.exclude] Folder names to skip.
 */
export function blogPostsPlugin({ appDir, contentDir = "blog", exclude = new Set() } = {}) {
  const root = join(appDir, contentDir);
  const base = "/" + contentDir;
  return {
    name: "otfw-blog-posts",
    resolveId(source) {
      return source === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const watch = [];
      const posts = existsSync(root) ? collectPosts(root, base, exclude, watch) : [];
      for (const f of watch) this.addWatchFile?.(f);
      return `export const posts = ${JSON.stringify(posts)};\nexport default posts;\n`;
    },
  };
}

/**
 * Scan the blog content folder and return the ordered post list — the same array the
 * `blogPostsPlugin` virtual module exposes, but callable directly (used by the RSS
 * feed generator at build time). Returns `[]` when the folder is absent.
 *
 * @param {Object} opts
 * @param {string} opts.appDir
 * @param {string} [opts.contentDir]
 * @param {Set<string>} [opts.exclude]
 */
export function loadPosts({ appDir, contentDir = "blog", exclude = new Set() } = {}) {
  const root = join(appDir, contentDir);
  if (!existsSync(root)) return [];
  return collectPosts(root, "/" + contentDir, exclude, []);
}

function collectPosts(root, base, exclude, watch) {
  const posts = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name.startsWith("_") ||
      exclude.has(entry.name)
    ) {
      continue;
    }
    const dir = join(root, entry.name);
    const page = readdirSync(dir).find((n) => PAGE_RE.test(n));
    if (!page) continue;

    const file = join(dir, page);
    watch.push(file);
    const source = readFileSync(file, "utf8");
    const fm = readFrontmatter(file);
    posts.push(
      clean({
        slug: entry.name,
        path: `${base}/${entry.name}`,
        title: fm.title ?? humanize(entry.name),
        description: fm.description,
        date: fm.date != null ? String(fm.date) : undefined,
        // Cover image (frontmatter `cover`) — shown on the post banner and the card.
        cover: fm.cover,
        author: fm.author,
        authorAvatar: fm.author_avatar,
        authorRole: fm.author_role,
        // Frontmatter is flat scalars, so `tags: a, b` arrives as a string; normalize
        // to a trimmed array. Components can render chips from it.
        tags: typeof fm.tags === "string" ? splitTags(fm.tags) : undefined,
        readingTime: readingTime(source),
        order: typeof fm.order === "number" ? fm.order : undefined,
      }),
    );
  }
  return sortPosts(posts);
}

/** Newest-first by `date`; a numeric `order` wins when present; title breaks ties. */
function sortPosts(posts) {
  return posts.sort((a, b) => {
    if (a.order != null || b.order != null) {
      return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title);
  });
}

function splitTags(s) {
  const tags = s.split(",").map((t) => t.trim()).filter(Boolean);
  return tags.length ? tags : undefined;
}

function humanize(seg) {
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function clean(node) {
  for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
  return node;
}
