# @opentf/web

## [Unreleased]

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
