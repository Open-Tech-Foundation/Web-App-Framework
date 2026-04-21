import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal, effect as _effect, signal as _signal } from "@preact/signals";
class StyleTestElement extends HTMLElement {
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
      const color = signal("red");
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _effect(() => Object.assign(el0.style, {
          display: "flex",
          gap: "10px"
        }));
        const el1 = document.createElement("span");
        _effect(() => Object.assign(el1.style, {
          color: color.value
        }));
        const text2 = document.createTextNode("Reactive Style");
        el1.appendChild(text2);
        el0.appendChild(el1);
        const el3 = document.createElement("div");
        el3.setAttribute("style", "font-weight: bold;");
        const text4 = document.createTextNode("Static Style String");
        el3.appendChild(text4);
        el0.appendChild(el3);
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
customElements.define("waf-styletest", StyleTestElement);
export default StyleTestElement;