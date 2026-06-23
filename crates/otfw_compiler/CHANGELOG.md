# otfw_compiler

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Added

- MDX code fences emit a titled code block: a `<div class="otfw-code">` wrapping a
  header (language label, an optional filename taken from the fence info string —
  e.g. ` ```json package.json ` — and a copy button) above the highlighted `<pre>`.
  The copy button ships both a clipboard and a check glyph (`.otfw-copy-icon` /
  `.otfw-check-icon`); the theme swaps to the green check when `.is-copied` is set.

### Fixed

- Components survive a DOM move instead of going inert. A custom element's
  `disconnectedCallback` disposed its reactive effects, while `connectedCallback`'s
  `if (this._mounted) return` guard blocked re-initialization — so any element that was
  disconnected and reconnected (e.g. a layout slotting `{props.children}` into its own
  subtree via `replaceChildren`, which moves every nested node) ended up mounted but
  dead: signals no longer updated the DOM. Teardown is now deferred to a microtask and
  cancelled if the element reconnects in the same task, so a synchronous move keeps the
  component and its live effects intact; only a real removal tears down (and clears
  `_mounted` so a later genuine remount re-initializes). This is what made interactive
  components inside a `DocsLayout`-wrapped page stop reacting.
- MDX prose no longer fuses words across a soft line break. A wrapped paragraph like
  `code is\n**highlighted**` kept the newline in the text node; the downstream JSX
  compiler then trimmed that boundary newline, rendering "ishighlighted". Inline text
  whitespace (incl. soft line breaks) is now collapsed to a single space — as HTML and
  CommonMark render it — so words and inline marks stay separated. Code spans/fences
  keep their literal whitespace. Affects every output path (CSR and SSG share the
  compiled module).
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
