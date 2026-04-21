import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal, computed as _computed, effect as _effect } from "@preact/signals";
class MacroTestElement extends HTMLElement {
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
      const count = _signal(0);
      const doubled = _computed(() => count.value * 2);
      _effect(() => {
        console.log("Count changed:", count.value);
      });
      const rootElement = (() => {
        const el0 = document.createElement("div");
        const el1 = document.createElement("p");
        const text2 = document.createTextNode("Count: ");
        el1.appendChild(text2);
        _renderDynamic(el1, () => count.value);
        el0.appendChild(el1);
        const el3 = document.createElement("p");
        const text4 = document.createTextNode("Doubled: ");
        el3.appendChild(text4);
        _renderDynamic(el3, () => doubled.value);
        el0.appendChild(el3);
        const el5 = document.createElement("button");
        el5.onclick = () => count.value++;
        const text6 = document.createTextNode("Increment");
        el5.appendChild(text6);
        el0.appendChild(el5);
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
customElements.define("waf-macrotest", MacroTestElement);
export default MacroTestElement;