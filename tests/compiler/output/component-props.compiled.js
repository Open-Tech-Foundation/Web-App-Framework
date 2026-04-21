import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal, effect as _effect } from "@preact/signals";
class ParentElement extends HTMLElement {
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
      const rootElement = (() => {
        const el0 = document.createElement("div");
        const el1 = document.createElement("waf-child");
        _effect(() => el1.val = count.value);
        el0.appendChild(el1);
        const el2 = document.createElement("button");
        el2.onclick = () => count.value++;
        const text3 = document.createTextNode("Inc");
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
customElements.define("waf-parent", ParentElement);
export default ParentElement;
class ChildElement extends HTMLElement {
  static observedAttributes = ["val"];
  set val(val) {
    this._propsSignals["val"].value = val;
  }
  get val() {
    return this._propsSignals["val"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      val: _signal(null)
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
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _renderDynamic(el0, () => props.val);
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
customElements.define("waf-child", ChildElement);