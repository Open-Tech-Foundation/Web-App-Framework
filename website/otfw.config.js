import { defineDocsConfig } from "@opentf/web-docs/config";

export default defineDocsConfig({
  site: { url: "https://web.opentechf.org" },

  // Docs generator: content lives under app/docs (routes under /docs). The marketing
  // navbar/footer come from the root app/layout.jsx, so the docs shell runs with
  // `frame={false}` (sidebar · content · TOC only) — see app/docs/layout.jsx.
  docs: {
    title: "OTF Web",
    version: "v0.27.0",
    logo: "/img/otf-logo.svg",
    // Show a "Last updated" line per page (every section), sourced from each file's
    // last git commit (or a `lastUpdated` frontmatter override).
    lastUpdated: true,
    github: "https://github.com/Open-Tech-Foundation/Web-App-Framework",
    // Source repo root — with lastUpdated, enables per-page "Edit this page" links
    // (`<repoUrl>/edit/main/<path>`) on every DocsLayout section (/docs, /api, …).
    repoUrl: "https://github.com/Open-Tech-Foundation/Web-App-Framework",
    nav: [
      { label: "Home", href: "/" },
      { label: "Docs", href: "/docs" },
      { label: "Packages", href: "/packages" },
      { label: "API", href: "/api" },
    ],
    // Static search is indexed after SSG into dist/_search/.
    search: { provider: "otf" },
  },

  // Blog generator: posts live under app/blog/<slug>/page.mdx. The toolchain resolves
  // `@opentf/web-docs/posts` to the post list (title/date/reading time from
  // frontmatter) for the index and the post banners.
  blog: {
    dir: "blog",
    // Show "Last updated" on a post when it was edited after its publish date.
    lastUpdated: true,
  },
});
