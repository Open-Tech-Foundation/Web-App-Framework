import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal as _signal } from "@preact/signals";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { effect as _effect } from "@preact/signals";
class MultipleComponentsElement extends HTMLElement {
  static observedAttributes = ["a", "b"];
  set a(val) {
    this._propsSignals["a"].value = val;
  }
  set b(val) {
    this._propsSignals["b"].value = val;
  }
  get a() {
    return this._propsSignals["a"].value;
  }
  get b() {
    return this._propsSignals["b"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      a: _signal(null),
      b: _signal(null)
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
        const el1 = document.createElement("waf-a");
        _effect(() => el1.val = props.a);
        el0.appendChild(el1);
        const el2 = document.createElement("waf-b");
        _effect(() => el2.val = props.b);
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
customElements.define("waf-multiplecomponents", MultipleComponentsElement);
export default MultipleComponentsElement;
class AElement extends HTMLElement {
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
customElements.define("waf-a", AElement);
class BElement extends HTMLElement {
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
customElements.define("waf-b", BElement);