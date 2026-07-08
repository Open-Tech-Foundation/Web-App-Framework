import { defineDocsConfig } from "@opentf/web-docs/config";

export default defineDocsConfig({
  site: { url: "https://web.opentechf.org" },

  // Docs generator: content lives under app/docs (routes under /docs). The marketing
  // navbar/footer come from the root app/layout.jsx, so the docs shell runs with
  // `frame={false}` (sidebar · content · TOC only) — see app/docs/layout.jsx.
  docs: {
    title: "OTF Web",
    version: "v0.16.0",
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
      { label: "API", href: "/api" },
    ],
    // Static search: `otfw build --ssg` indexes the pre-rendered HTML with Pagefind
    // into dist/pagefind/; the navbar ⌘K trigger and modal query it at runtime.
    search: { provider: "pagefind" },
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
