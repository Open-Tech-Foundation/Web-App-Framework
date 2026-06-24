---
"@opentf/web-docs": minor
---

Documentation-site theme: search, MDX niceties, and design polish.

- Pagefind-backed docs search: a ⌘K / Ctrl+K modal that lazy-loads a static index and queries it client-side, with section-level results that deep-link to the matched heading and show each page's breadcrumb trail. Build hook `indexWithPagefind` from `@opentf/web-docs/build`.
- Code blocks get a header bar (language label, optional filename, copy button that turns green with a check); a `CodeBlock` component renders the same structure for non-fence code.
- `Steps` component (numbered walkthrough); `Tabs` renders `content` as-is and covers the package-manager "code group" pattern (replacing `CodeGroup`). Exports `NavbarLink`, `NavIcon`, `Steps`.
- Navbar: active-route underline, per-link icons via a `NavIcon` registry, and a version badge.
- Hover `#` heading anchors; aligned Markdown tables.
- Design: callout redesign, sidebar dot markers, full h1–h6 prose scale.
- Fixes: `Pagination` null crash on the first/last page, prose list markers, GFM task-list styling, copy-button Clipboard-API fallback, sticky `display: contents` navbar host.
