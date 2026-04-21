import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal as _signal } from "@preact/signals";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal, effect as _effect } from "@preact/signals";
class ReactivityElement extends HTMLElement {
  static observedAttributes = ["title"];
  set title(val) {
    this._propsSignals["title"].value = val;
  }
  get title() {
    return this._propsSignals["title"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      title: _signal(null)
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
      const count = signal(0);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _effect(() => el0.title = props.title);
        const el1 = document.createElement("span");
        _renderDynamic(el1, () => count.value);
        el0.appendChild(el1);
        const el2 = document.createElement("button");
        el2.onclick = () => count.value++;
        const text3 = document.createTextNode("Add");
        el2.appendChild(text3);
        el0.appendChild(el2);
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
customElements.define("waf-reactivity", ReactivityElement);
export default ReactivityElement;