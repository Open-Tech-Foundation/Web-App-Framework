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
 *
 * @typedef {Object} DocsFooter
 * @property {string} [text]
 * @property {DocsNavLink[]} [links]
 *
 * @typedef {Object} DocsConfig
 * @property {string} [title]        Site/product name shown in the navbar.
 * @property {string} [logo]         URL of the navbar logo image.
 * @property {string} [homeUrl]      Where the navbar brand links to (default "/").
 * @property {string} [github]       GitHub URL (shown in the navbar).
 * @property {string} [dir]          Docs content folder under app/ (default "docs").
 * @property {DocsNavLink[]} [nav]   Top-level navbar links.
 * @property {DocsFooter} [footer]   Footer content.
 * @property {{ provider?: string }} [search]  Search provider (Phase 2: "pagefind").
 *
 * @typedef {Object} SiteConfig
 * @property {{ url?: string }} [site]   Canonical site origin (for SEO / sitemap).
 * @property {DocsConfig} [docs]         Documentation generator config.
 */

/**
 * @param {SiteConfig} config
 * @returns {SiteConfig}
 */
export function defineDocsConfig(config) {
  return config;
}

export default defineDocsConfig;
