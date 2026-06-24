# @opentf/web

## [Unreleased]

### Added

- Per-route SEO metadata + `<head>` rendering for SSG (`server/head.js`). Pages and
  layouts declare a Next-style plain-data `export const metadata` (and/or
  `generateMetadata({ params, query })`); `resolveMetadata` merges the layout chain
  under the page (deep-merging `openGraph`/`twitter`/`robots`), and `renderHead`
  emits `<title>`, description, canonical, robots, Open Graph, Twitter Card, JSON-LD,
  and arbitrary `meta`/`link` tags — with relative URLs made absolute against the
  configured site origin.
- `RawHtml` built-in component (`web-internal-raw-html`) for injecting trusted HTML,
  plus runtime support for `.mdx`/`.md` route modules so Markdown/MDX pages render
  through the normal router.
- SEO head: `titleTemplate` (a string with `%s`) lets a layout brand every child
  page's `<title>` — e.g. `titleTemplate: "%s — OTF Web"` renders a page titled
  `Installation` as `Installation — OTF Web`. A page opts out with
  `title: { absolute: "…" }`. The templated/absolute title is also used for the
  `og:title` / `twitter:title` fallbacks.

### Changed

- Reserved the `web-internal-*` custom-element prefix for framework built-ins (Portal,
  RawHtml, …) and added an SSG host hook so built-ins render correctly when
  pre-rendered.
- Performance: reactive bindings now elide no-op writes (a binding whose computed
  value is unchanged skips the DOM write), and keyed list reconciliation does
  minimal moves instead of re-appending — cutting needless DOM work on updates.

### Fixed

- `router.pathname` now drops a trailing slash (except for root `/`), so a URL like
  `/docs/x/` — how a static host serves a page, and how a Pagefind search result links
  to it — matches the no-trailing-slash route table and nav paths. Without this, landing
  on or navigating to a trailing-slash URL silently blanked the breadcrumb, active
  sidebar link, and TOC (they compare against `router.pathname`).
- Router now resets scroll on forward navigation: a `push`/`replace` to a new route
  lands at the top of the page (or scrolls to the targeted `#anchor`), instead of
  keeping the previous page's scroll position. Back/forward navigation still restores
  the browser's remembered position.

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
