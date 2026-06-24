---
"@opentf/web-compiler": minor
---

MDX table alignment, heading anchors, and brotli-compressed binaries.

- MDX: GFM table column alignment — the `:--` / `:-:` / `--:` delimiter row emits inline `text-align` per column.
- MDX: each heading emits a self-linking `.otfw-heading-anchor` (aria-hidden, hidden until hover) so sections are shareable.
- Prebuilt `otfwc` binaries now ship brotli-compressed (~0.65 MB vs ~2.3 MB raw); a `postinstall` decompresses only the host's binary, with a lazy fallback in `otfwcPath()`. Uses Node's `zlib` (no extra dependency) and yields a byte-identical, runnable binary.
