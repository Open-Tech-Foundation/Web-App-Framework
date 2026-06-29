# @opentf/web

## [Unreleased]

### Added

- `renderRoute` now returns an HTTP `status` alongside `{ html, metadata }`: `200` when
  the path matched a real route, `404` when it fell back to the registered 404 page. The
  new `otfw serve` SSR server uses it to set the response status; SSG ignores it (the
  field is additive, so existing `{ html, metadata }` destructuring is unaffected).
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
