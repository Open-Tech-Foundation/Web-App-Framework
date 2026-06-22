//! RawHtml — render a trusted HTML string as light-DOM content.
//
//   <RawHtml html={"<pre>…</pre>"} />   // compiles to the built-in `web-internal-raw-html`
//
// Used by the MDX front-end for build-time syntax-highlighted code blocks: the
// highlighted markup is static (no reactivity), so the element just assigns its
// `html` property to `innerHTML`. The string is treated as trusted — it comes from
// the compiler, not user input. SSG renders the string inline (server/builtins.js).

export class RawHtmlElement extends HTMLElement {
  set html(v) {
    this._html = v;
    if (this.isConnected) this.innerHTML = v == null ? "" : String(v);
  }
  get html() {
    return this._html;
  }

  connectedCallback() {
    // Apply once on connect (the property is set before append during CSR build).
    if (this._html != null && !this._applied) {
      this.innerHTML = String(this._html);
      this._applied = true;
    }
  }
}

// Exported so `import { RawHtml } from "@opentf/web"` resolves; the import side
// effect registers the element (JSX uses the `web-internal-raw-html` tag).
export const RawHtml = RawHtmlElement;
if (typeof customElements !== "undefined" && !customElements.get("web-internal-raw-html")) {
  customElements.define("web-internal-raw-html", RawHtmlElement);
}
