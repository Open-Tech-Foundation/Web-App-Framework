# @opentf/web-docs

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Added

- Code blocks now render a header bar — a language label, an optional filename (from
  the fence info string, e.g. ` ```json package.json `), and a copy button on the
  right that, on click, turns green, swaps its clipboard glyph for a check icon, and
  reads "Copied". The header markup is emitted by the MDX front-end; `DocsLayout`
  wires the copy action with one delegated listener, so it keeps working across
  client navigation with no per-element bookkeeping.
- `Steps` component — a numbered, vertically-connected walkthrough where each child
  heading becomes a step (composes with plain Markdown headings in MDX).
- `CodeBlock` component — renders the same `.otfw-code` header-and-`<pre>` structure
  as the MDX front-end (including the copy button), for code that doesn't come from a
  Markdown fence. The docs layout's single delegated copy listener handles it for
  free. Exported from the package root.
- `Tabs` renders `content` as-is — a string is plain text, a node is the node. For a
  code panel with a copy button, pass a `CodeBlock`
  (`{ label, content: <CodeBlock code="…" /> }`). `Tabs` covers the package-manager
  "code group" pattern this way, so a separate `CodeGroup` is no longer shipped.
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

- Code-block copy button now actually copies. The earlier handler called
  `navigator.clipboard.writeText(...)` with no error path, so the copy silently
  failed whenever the async Clipboard API rejected (denied permission / page without
  focus / non-secure context). It now catches the rejection and falls back to a
  `document.execCommand("copy")` path. (The mount-time listener wiring was *not* at
  fault — verified: the `$ref` holds the live `#otfw-content` at `onMount` and the
  delegated click listener fires.)
- The navbar host is now `display: contents`, so its sticky header pins to the page
  scroll container instead of scrolling away inside its own wrapper.
- The brand takes the leading space so nav links group with the GitHub icon and theme
  toggle on the right; icon buttons are normalized to uniform squares and vertically
  centered.
