// A code block matching the MDX front-end's `.otfw-code` structure (header bar with
// an optional language/filename label and a copy button, above a `<pre>`). Use it for
// code that doesn't come from a Markdown fence — e.g. a code panel inside `Tabs`:
// `{ label, content: <CodeBlock code="…" /> }`. The text is NOT syntax-highlighted —
// highlighting is a build-time (syntect) pass that only sees literal Markdown fences,
// not a runtime string prop; runtime highlighting here is deferred future work. The
// docs layout's single delegated listener (on
// `#otfw-content`) drives the copy, so no wiring is needed here. The icon glyphs go
// through `RawHtml` because inline `<svg>` would be created in the HTML namespace and
// not render.
import { RawHtml } from "@opentf/web";

const COPY_SVG =
  '<svg class="otfw-copy-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG =
  '<svg class="otfw-check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICONS = COPY_SVG + CHECK_SVG;

export default function CodeBlock(props) {
  return (
    <div class="otfw-code">
      <div class="otfw-code-head">
        {props.lang ? <span class="otfw-code-lang">{props.lang}</span> : null}
        {props.name ? <span class="otfw-code-name">{props.name}</span> : null}
        <button class="otfw-copy" type="button" aria-label="Copy code">
          <RawHtml html={ICONS} />
          <span class="otfw-copy-label">Copy</span>
        </button>
      </div>
      <pre>
        <code>{props.code}</code>
      </pre>
    </div>
  );
}
