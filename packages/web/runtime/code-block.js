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
import { isHydrating } from "./hydrate.js";

export class CodeBlockElement extends HTMLElement {
  set html(v) {
    this._html = v;
    if (!this.isConnected) return;
    // First value handed to a host that adopted its server DOM: that markup *is* this
    // string (same compiler, same build), so re-rendering would destroy and re-parse the
    // block we just adopted — the single biggest source of first-paint churn on a docs
    // site. The adopt walk always re-applies the prop, because the MDX front-end writes
    // `html={"…"}` as an expression, so this arm is the common case. Just record it; a
    // genuinely *different* value later still renders.
    if (this._adopted) {
      this._adopted = false;
      this._applied = v;
      return;
    }
    if (v !== this._applied) this.render();
  }
  get html() {
    return this._html;
  }

  connectedCallback() {
    // Server-rendered inline by `server/builtins.js` and adopted on first paint: keep the
    // markup, wire only the behavior (docs/HYDRATION.md §3.4 — the same
    // `isHydrating() && this.firstChild` discriminator a compiled component uses).
    if (isHydrating() && this.firstChild) {
      this._adopted = true;
      this._rendered = true;
      this._applied = this._html;
      this.wireCopy();
      return;
    }
    // The `html` property is set before append during a CSR build; render once.
    if (!this._rendered) this.render();
  }

  render() {
    this.innerHTML = this._html == null ? "" : String(this._html);
    this._applied = this._html;
    this.wireCopy();
    this._rendered = true;
  }

  /** Wire the copy button to the block's `<pre>` text (idempotent). */
  wireCopy() {
    const button = this.querySelector(".otfw-copy");
    const pre = this.querySelector("pre");
    if (button && pre && !button._otfwWired) {
      button._otfwWired = true;
      button.addEventListener("click", () => copyWithFeedback(button, pre.innerText));
    }
  }
}

// Exported so the bare import in runtime/index.js retains the registration side
// effect; JSX addresses it by the `web-internal-code-block` tag (no import needed).
export const CodeFence = CodeBlockElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-code-block")) {
  customElements.define("web-internal-code-block", CodeBlockElement);
}
