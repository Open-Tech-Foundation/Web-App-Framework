# @opentf/web-docs

## [Unreleased]

### Fixed

- Code-block copy buttons now work in any layout, not just the docs shell. `CodeBlock`
  wires its own `onclick` (and MDX fences use the self-wiring `web-internal-code-block`
  built-in), so the delegated copy listener that lived in `DocsLayout` — and silently
  did nothing outside it — is gone.

### Changed

- Navbar version badge now uses neutral surface / muted-text / border styling instead
  of the theme accent color, so it reads as metadata rather than a call to action.
