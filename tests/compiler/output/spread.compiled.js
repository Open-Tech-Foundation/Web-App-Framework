import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal as _signal } from "@preact/signals-core";
import { applySpread as _applySpread } from "/framework/runtime/props.js";
class SpreadTestElement extends HTMLElement {
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
      const props = {
        id: "test",
        className: "foo",
        "data-custom": "bar"
      };
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _applySpread(el0, props);
        const el1 = document.createElement("span");
        _applySpread(el1, {
          style: {
            color: "red"
          }
        });
        const text2 = document.createTextNode("Hello");
        el1.appendChild(text2);
        el0.appendChild(el1);
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
customElements.define("mwaf-spreadtest", SpreadTestElement);
export default SpreadTestElement;