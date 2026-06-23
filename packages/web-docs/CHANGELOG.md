# @opentf/web-docs

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Added

- Code blocks get a copy button automatically. `DocsLayout` decorates every
  `<pre>` in the prose at runtime (via a `MutationObserver`, so it survives client
  navigation): a rounded copy pill that turns green and reads "Copied" on click.
- `Steps` component — a numbered, vertically-connected walkthrough where each child
  heading becomes a step (composes with plain Markdown headings in MDX).
- Navbar: active-route underline that updates on SPA navigation, per-link icons via
  a named `NavIcon` registry (`nav: [{ label, href, icon, external }]`), and a
  `version` badge next to the brand.
- `NavbarLink`, `NavIcon`, and `Steps` are now exported from the package root.

### Changed

- Callouts restyled to the updated design system: a two-column grid puts a plain,
  accent-tinted icon in its own column beside the title and body, with a per-type
  accent driving the tinted fill, border, and title color (`color-mix`, so they
  adapt to light/dark automatically).
- Sidebar links gained dot markers (dimmed by default, solid on the active route).
- The navbar search trigger only renders when a search provider is configured.

### Fixed

- The navbar host is now `display: contents`, so its sticky header pins to the page
  scroll container instead of scrolling away inside its own wrapper.
- The brand takes the leading space so nav links group with the GitHub icon and theme
  toggle on the right; icon buttons are normalized to uniform squares and vertically
  centered.
