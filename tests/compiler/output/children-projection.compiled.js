import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal as _signal } from "@preact/signals";
class WrapperElement extends HTMLElement {
  static observedAttributes = [];
  constructor() {
    super();
    this._propsSignals = {};
  }
  attributeChangedCallback(name, _, value) {
    this._propsSignals[name].value = value;
  }
  connectedCallback() {
    this._onMounts = [];
    this._onCleanups = [];
    const props = _createPropsProxy(this);
    _withInstance(this, () => {
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "wrapper";
        const el1 = document.createElement("header");
        const text2 = document.createTextNode("Header");
        el1.appendChild(text2);
        el0.appendChild(el1);
        const el3 = document.createElement("main");
        el0.appendChild(el3);
        const el4 = document.createElement("footer");
        const text5 = document.createTextNode("Footer");
        el4.appendChild(text5);
        el0.appendChild(el4);
        return el0;
      })();
      while (this.firstChild) rootElement.appendChild(this.firstChild);
      this.appendChild(rootElement);
    });
    this._onMounts.forEach(fn => fn());
  }
  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
  }
}
customElements.define("waf-wrapper", WrapperElement);
export default WrapperElement;