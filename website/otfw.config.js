import { defineDocsConfig } from "@opentf/web-docs/config";

export default defineDocsConfig({
  site: { url: "https://otfw.dev" },

  // Docs generator: content lives under app/docs (routes under /docs). The marketing
  // navbar/footer come from the root app/layout.jsx, so the docs shell runs with
  // `frame={false}` (sidebar · content · TOC only) — see app/docs/layout.jsx.
  docs: {
    title: "OTF Web",
    version: "v0.4.0",
    logo: "/logo.png",
    dir: "docs",
    github: "https://github.com/Open-Tech-Foundation/Web-App-Framework",
    nav: [
      { label: "Home", href: "/" },
      { label: "Docs", href: "/docs" },
    ],
    // Static search: `otfw build --ssg` indexes the pre-rendered HTML with Pagefind
    // into dist/pagefind/; the navbar ⌘K trigger and modal query it at runtime.
    search: { provider: "pagefind" },
  },
});
