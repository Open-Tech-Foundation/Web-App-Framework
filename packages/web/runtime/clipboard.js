//! Clipboard helpers for "copy" affordances (code blocks, etc.).
//
// Behavior travels with the component that needs it — these are imported by the
// `web-internal-code-block` built-in and by `@opentf/web-docs`'s `CodeBlock`, so a
// copy button works wherever it's rendered, with no cooperation from an ancestor
// layout. `copyText` prefers the async Clipboard API and falls back to a hidden
// `<textarea>` + `execCommand` for non-secure contexts / older browsers.

export function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* clipboard unavailable */
  }
}

/**
 * Copy `text`, then give `button` the standard "Copied" feedback: add `is-copied`,
 * swap its `.otfw-copy-label` to "Copied", and revert after 2s. Idempotent across
 * rapid clicks (the pending revert is reset each time).
 */
export function copyWithFeedback(button, text) {
  copyText(text);
  const label = button.querySelector(".otfw-copy-label");
  button.classList.add("is-copied");
  if (label) label.textContent = "Copied";
  clearTimeout(button._otfwCopyT);
  button._otfwCopyT = setTimeout(() => {
    button.classList.remove("is-copied");
    if (label) label.textContent = "Copy";
  }, 2000);
}
