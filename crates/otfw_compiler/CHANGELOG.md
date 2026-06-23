# otfw_compiler

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Fixed

- Preserve a component's consumer `class` prop. When a component declares a `class`
  prop, the host-styling hook stamp (`classList.add`) re-entered
  `attributeChangedCallback` and overwrote the prop with the post-stamp string — so
  `<Link class="…">` rendered only the host hook. The stamp is now bracketed by a
  guard flag so the synthetic mutation is ignored by the prop sync.
