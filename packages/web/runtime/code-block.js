//! Code block — a built-in that renders a (build-time syntax-highlighted) code block
//! and **owns its copy behavior**.
//
//   <CodeFence html={"<div class='otfw-code'>…<button class='otfw-copy'>…</button><pre>…</pre></div>"} />
//
// The MDX front-end emits this for fenced code (compiles to `web-internal-code-block`,
// like `<RawHtml>` → `web-internal-raw-html`). The highlighted markup is a trusted
// string from the compiler, so it's assigned to `innerHTML`; the difference from
// `RawHtml` is that on connect this element wires its own `.otfw-copy` button to copy
// the `<pre>` text. That keeps copy working wherever a code block is rendered (docs,
// blog, anywhere) — no delegated listener in a layout. SSG renders the string inline
// (server/builtins.js); the behavior wires when the element upgrades in the browser.

import { copyWithFeedback } from "./clipboard.js";

export class CodeBlockElement extends HTMLElement {
  set html(v) {
    this._html = v;
    if (this.isConnected) this.render();
  }
  get html() {
    return this._html;
  }

  connectedCallback() {
    // The `html` property is set before append during a CSR build; render once.
    if (!this._rendered) this.render();
  }

  render() {
    this.innerHTML = this._html == null ? "" : String(this._html);
    const button = this.querySelector(".otfw-copy");
    const pre = this.querySelector("pre");
    if (button && pre && !button._otfwWired) {
      button._otfwWired = true;
      button.addEventListener("click", () => copyWithFeedback(button, pre.innerText));
    }
    this._rendered = true;
  }
}

// Exported so the bare import in runtime/index.js retains the registration side
// effect; JSX addresses it by the `web-internal-code-block` tag (no import needed).
export const CodeFence = CodeBlockElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-code-block")) {
  customElements.define("web-internal-code-block", CodeBlockElement);
}
