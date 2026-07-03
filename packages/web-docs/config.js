// Site/docs configuration helper.
//
// `defineDocsConfig` is an identity function: it returns the config untouched, but
// gives authors editor type-hints (via the JSDoc typedef) and a stable import the
// toolchain can recognise. Used in `otfw.config.js`:
//
//   import { defineDocsConfig } from "@opentf/web-docs/config";
//   export default defineDocsConfig({ site: { url }, docs: { … } });

/**
 * @typedef {Object} DocsNavLink
 * @property {string} label
 * @property {string} href
 * @property {string} [icon]        NavIcon name shown before the label (e.g. "book").
 * @property {boolean} [external]   Render as a plain target=_blank anchor (no SPA nav).
 *
 * @typedef {Object} DocsFooter
 * @property {string} [text]
 * @property {DocsNavLink[]} [links]
 *
 * @typedef {Object} DocsConfig
 * @property {string} [title]        Site/product name shown in the navbar.
 * @property {string} [version]      Version badge shown next to the brand (e.g. "v0.4.0").
 * @property {string} [logo]         URL of the navbar logo image.
 * @property {string} [homeUrl]      Where the navbar brand links to (default "/").
 * @property {string} [github]       GitHub URL (shown in the navbar).
 * @property {string} [repoUrl]      Source repository URL. When set (with `lastUpdated`),
 *                            each docs page gets an "Edit this page" link to its file on
 *                            GitHub (`<repoUrl>/edit/main/<path>`).
 * @property {string} [dir]          Docs content folder under app/ (default "docs"). Any
 *                            other top-level folder with a `DocsLayout` is its own section
 *                            (e.g. `app/api` → `/api`) — no extra config needed.
 * @property {DocsNavLink[]} [nav]   Top-level navbar links.
 * @property {DocsFooter} [footer]   Footer content.
 * @property {{ provider?: string }} [search]  Search provider (Phase 2: "pagefind").
 * @property {boolean} [lastUpdated] Show a "Last updated" line per docs page (from the
 *                            file's last git commit, or a `lastUpdated` frontmatter
 *                            override; `lastUpdated: false` in frontmatter hides a page).
 *
 * @typedef {Object} BlogConfig
 * @property {string} [dir]   Blog content folder under app/ (default "blog"). Each
 *                            `<dir>/<slug>/page.mdx` is a post; its frontmatter
 *                            (title, description, date, author, tags) feeds the
 *                            generated `@opentf/web-docs/posts` list.
 * @property {string} [title]        Feed title (default `"<docs.title> Blog"`).
 * @property {string} [description]  Feed description (default the title). RSS and Atom
 *                            feeds (`<dir>/rss.xml`, `<dir>/atom.xml`) are generated
 *                            by `otfw build` when `site.url` is set; public feed files
 *                            override generated ones independently.
 * @property {boolean} [lastUpdated] Show a "Last updated" line on a post when it was
 *                            edited after its publish date (from git / frontmatter).
 *
 * @typedef {Object} SiteConfig
 * @property {{ url?: string }} [site]   Canonical site origin (for SEO / sitemap).
 * @property {DocsConfig} [docs]         Documentation generator config.
 * @property {BlogConfig} [blog]         Blog generator config.
 */

/**
 * @param {SiteConfig} config
 * @returns {SiteConfig}
 */
export function defineDocsConfig(config) {
  return config;
}

export default defineDocsConfig;
