# otfw_compiler

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Fixed

- MDX syntax highlighting now covers JSX/TSX/TS/MDX code fences. syntect's default
  grammar set has no `jsx`/`tsx`/`ts`/`mdx` entries, so those fences silently fell
  back to plain text (no highlighting) — which was most of the documentation's
  examples. Such tokens are now aliased to the closest available grammar (`js`, `md`,
  `bash`) before falling back to plain text.
- Preserve a component's consumer `class` prop. When a component declares a `class`
  prop, the host-styling hook stamp (`classList.add`) re-entered
  `attributeChangedCallback` and overwrote the prop with the post-stamp string — so
  `<Link class="…">` rendered only the host hook. The stamp is now bracketed by a
  guard flag so the synthetic mutation is ignored by the prop sync.
