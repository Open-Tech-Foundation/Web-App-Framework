import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal } from "@preact/signals-core";
class NestedFragmentsElement extends HTMLElement {
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
      let show = _signal(true);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _renderDynamic(el0, () => show.value && (() => {
          const frag0 = document.createDocumentFragment();
          const el1 = document.createElement("span");
          const text2 = document.createTextNode("A");
          el1.appendChild(text2);
          frag0.appendChild(el1);
          const frag3 = document.createDocumentFragment();
          const el4 = document.createElement("span");
          const text5 = document.createTextNode("B");
          el4.appendChild(text5);
          frag3.appendChild(el4);
          const el6 = document.createElement("span");
          const text7 = document.createTextNode("C");
          el6.appendChild(text7);
          frag3.appendChild(el6);
          frag0.appendChild(frag3);
          return frag0;
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
customElements.define("waf-nestedfragments", NestedFragmentsElement);
export default NestedFragmentsElement;