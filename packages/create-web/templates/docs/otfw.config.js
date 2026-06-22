import { defineDocsConfig } from "@opentf/web-docs/config";

export default defineDocsConfig({
  // Canonical site origin — used for SEO canonical URLs + sitemap.xml.
  site: { url: "https://example.com" },

  docs: {
    title: "My Docs",
    // Docs content lives at the app root (routes at "/"). Set to a folder name
    // (e.g. "docs") to serve docs under "/docs" alongside other pages.
    dir: ".",
    nav: [{ label: "Guide", href: "/guide" }],
    github: "https://github.com/your-org/your-repo",
    footer: { text: "© 2026 My Project" },
    // Phase 2: static search. Add `pagefind` as a devDependency to enable.
    // search: { provider: "pagefind" },
  },
});
