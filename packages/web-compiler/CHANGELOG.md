# @opentf/web-compiler

## [Unreleased]

### Added

- MDX: GFM table column alignment. The delimiter row's colons (`:--` left, `:-:`
  center, `--:` right) now emit an inline `style="text-align:…"` on every cell in
  that column (`AlignKind::None` adds nothing), so aligned pipe tables render aligned.
- MDX: each heading now emits a self-linking anchor (`<a class="otfw-heading-anchor"
  href="#slug">#</a>`, `aria-hidden`, `tabindex="-1"`) after its text, so headings are
  shareable. It's visually hidden until the heading is hovered (styled by the consuming
  theme).

### Changed

- Prebuilt `otfwc` binaries now ship brotli-compressed (`bin/<platform>/otfwc[.exe].br`,
  ~0.65 MB vs ~2.3 MB raw); a `postinstall` decompresses only the host's binary, and
  `otfwcPath()` decompresses lazily as a fallback (for `--ignore-scripts` installs).
  Uses Node's `zlib` — no extra runtime/CLI dependency — and yields a byte-identical,
  runnable binary.

## 0.1.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
