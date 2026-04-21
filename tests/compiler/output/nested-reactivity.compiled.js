import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal, effect as _effect } from "@preact/signals-core";
class NestedReactivityElement extends HTMLElement {
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
      let show = _signal(true);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _renderDynamic(el0, () => show.value && (() => {
          const el0 = document.createElement("span");
          _effect(() => el0.title = props.title);
          const text1 = document.createTextNode("Hello");
          el0.appendChild(text1);
          return el0;
        })());
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
customElements.define("waf-nestedreactivity", NestedReactivityElement);
export default NestedReactivityElement;