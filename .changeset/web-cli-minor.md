---
"@opentf/web-cli": minor
---

MDX builds, SSG head/sitemap, docs search indexing, and a phased build UI.

- Resolve and compile `.mdx`/`.md` modules through `otfwc`'s MDX front-end.
- SSG: inject per-route `<head>` from resolved metadata, pre-render dynamic routes, and emit `sitemap.xml` + `robots.txt`.
- Docs-site generator integration: a nav plugin builds the sidebar from the docs directory, dedups group landing pages, and honors route exclusions — driven by `otfw.config.js`.
- `otfw build --ssg` runs a Pagefind index pass when docs search is configured (`@opentf/web-docs/build`'s `indexWithPagefind`), with live progress.
- Phased build output: per-phase spinners with live detail, collapsing to green ✅ lines with elapsed time, ending with `→ dist/ ready in …`; quiet on non-TTY streams.
- Silence Rolldown's `PLUGIN_TIMINGS` advisory (the per-file compiler subprocess dominates plugin time by design).
- Fix: dev server serves `public/` assets (e.g. `/logo.png`).
