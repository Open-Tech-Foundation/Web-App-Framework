---
"@opentf/web": minor
---

SSG SEO/head rendering, MDX routes, and reactivity performance.

- Per-route SEO metadata + `<head>` rendering (`server/head.js`): Next-style `metadata` / `generateMetadata`, layout-chain merge, and `renderHead` emitting title, description, canonical, robots, Open Graph, Twitter Card, and JSON-LD. `titleTemplate` ("%s — Site") brands child-page titles; `title: { absolute }` opts out.
- `RawHtml` built-in (`web-internal-raw-html`) and `.mdx`/`.md` route module support.
- Reserved the `web-internal-*` prefix for framework built-ins (Portal, RawHtml) plus an SSG host hook so they pre-render correctly.
- Performance: reactive bindings elide no-op writes; keyed list reconciliation does minimal moves instead of re-appending.
- Fixes: `router.pathname` drops a trailing slash (so `/docs/x/` matches the route table); forward navigation resets scroll (honoring `#anchor`), back/forward restores position.
