# @opentf/web

## [Unreleased]

### Fixed

- Router now resets scroll on forward navigation: a `push`/`replace` to a new route
  lands at the top of the page (or scrolls to the targeted `#anchor`), instead of
  keeping the previous page's scroll position. Back/forward navigation still restores
  the browser's remembered position.

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
