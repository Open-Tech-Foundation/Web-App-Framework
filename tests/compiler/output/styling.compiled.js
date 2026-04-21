import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal, effect as _effect, signal as _signal } from "@preact/signals";
class StylingTestElement extends HTMLElement {
  static observedAttributes = ["theme"];
  set theme(val) {
    this._propsSignals["theme"].value = val;
  }
  get theme() {
    return this._propsSignals["theme"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      theme: _signal(null)
    };
  }
  attributeChangedCallback(name, _, value) {
    this._propsSignals[name].value = value;
  }
  connectedCallback() {
    this._onMounts = [];
    this._onCleanups = [];
    const props = _createPropsProxy(this);
    _withInstance(this, () => {
      const active = signal(true);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "static-class";
        el0.className = "static-classname";
        const el1 = document.createElement("span");
        _effect(() => el1.className = active.value ? "active" : "inactive");
        const text2 = document.createTextNode("Reactive Class");
        el1.appendChild(text2);
        el0.appendChild(el1);
        const el3 = document.createElement("button");
        _effect(() => el3.className = props.theme);
        const text4 = document.createTextNode("Reactive ClassName from Props");
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
customElements.define("waf-stylingtest", StylingTestElement);
export default StylingTestElement;