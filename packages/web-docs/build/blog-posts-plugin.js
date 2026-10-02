// Build-time blog post index generator (a Rolldown plugin), the blog counterpart of
// docs-nav-plugin.js. It scans `app/<dir>` for post folders (`<slug>/page.{mdx,md}`),
// reads each post's frontmatter + computes its reading time, and resolves the virtual
// module `@opentf/web-docs/posts` to the ordered post list. A pure build-time
// consumer of the file tree — no compiler stage, no runtime cost.
//
// Post shape: `{ slug, path, title, description?, date?, author?, tags?, readingTime,
// order? }`. Sorted newest-first by `date`; a numeric `order` (frontmatter) overrides.

import { join } from "runtime:path";

import { exists, readEntries, readNames, readText } from "./host.js";

import { readFrontmatter } from "./frontmatter.js";
import { readingTime } from "./reading-time.js";

const VIRTUAL_ID = "@opentf/web-docs/posts";
// No NUL sentinel: the bundler marks a module virtual explicitly, and a `\0` in
// a hook filter is an invalid regex — which silently matches *everything*.
const RESOLVED_ID = "otfw-virtual:otfw-blog-posts";
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
    resolve: {
      filter: { id: VIRTUAL_ID },
      handler: (source) => (source === VIRTUAL_ID ? { id: RESOLVED_ID, virtual: true } : null),
    },
    load: {
      filter: { id: RESOLVED_ID },
      async handler(id) {
        if (id !== RESOLVED_ID) return null;
        const watch = [];
        const posts = (await exists(root)) ? await collectPosts(root, base, exclude, watch) : [];
        // The post list is generated from these files, which nothing imports —
        // declaring them is what rebuilds the chunk when a post's frontmatter changes.
        return {
          code: `export const posts = ${JSON.stringify(posts)};\nexport default posts;\n`,
          dependsOn: watch,
        };
      },
    },
  };
}

/**
 * Scan the blog content folder and return the ordered post list — the same array the
 * `blogPostsPlugin` virtual module exposes, but callable directly (used by the feed
 * generator at build time). Returns `[]` when the folder is absent.
 *
 * @param {Object} opts
 * @param {string} opts.appDir
 * @param {string} [opts.contentDir]
 * @param {Set<string>} [opts.exclude]
 */
export async function loadPosts({ appDir, contentDir = "blog", exclude = new Set() } = {}) {
  const root = join(appDir, contentDir);
  if (!(await exists(root))) return [];
  return collectPosts(root, "/" + contentDir, exclude, []);
}

// Automatic post metadata describes concrete folders; generated parameters are
// unavailable during this scan and must not become card or feed URLs.
async function collectPosts(root, base, exclude, watch) {
  const posts = [];
  for (const entry of await readEntries(root)) {
    if (
      !entry.isDir ||
      entry.name.startsWith(".") ||
      entry.name.startsWith("_") ||
      /\[[^\]]+\]/.test(entry.name) ||
      exclude.has(entry.name)
    ) {
      continue;
    }
    const dir = join(root, entry.name);
    const page = (await readNames(dir)).find((n) => PAGE_RE.test(n));
    if (!page) continue;

    const file = join(dir, page);
    watch.push(file);
    const source = await readText(file);
    const fm = await readFrontmatter(file);
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
