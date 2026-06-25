# @opentf/web

## 0.6.0

### Minor Changes

- 66fecf0: SSG SEO/head rendering, MDX routes, and reactivity performance.

  - Per-route SEO metadata + `<head>` rendering (`server/head.js`): Next-style `metadata` / `generateMetadata`, layout-chain merge, and `renderHead` emitting title, description, canonical, robots, Open Graph, Twitter Card, and JSON-LD. `titleTemplate` ("%s — Site") brands child-page titles; `title: { absolute }` opts out.
  - `RawHtml` built-in (`web-internal-raw-html`) and `.mdx`/`.md` route module support.
  - Reserved the `web-internal-*` prefix for framework built-ins (Portal, RawHtml) plus an SSG host hook so they pre-render correctly.
  - Performance: reactive bindings elide no-op writes; keyed list reconciliation does minimal moves instead of re-appending.
  - Fixes: `router.pathname` drops a trailing slash (so `/docs/x/` matches the route table); forward navigation resets scroll (honoring `#anchor`), back/forward restores position.

## [Unreleased]

### Added

- `web-internal-code-block` built-in (emitted by the MDX front-end as `<CodeFence>`):
  renders a trusted, build-time-highlighted code block like `RawHtml`, but **wires its
  own copy button** on connect. So a code block's copy action works wherever it's
  rendered, with no delegated listener in an ancestor layout. SSG renders the markup
  inline; the behavior wires when the element upgrades in the browser.
- `copyText(text)` and `copyWithFeedback(button, text)` clipboard helpers (async
  Clipboard API with an `execCommand` fallback for non-secure contexts).

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
