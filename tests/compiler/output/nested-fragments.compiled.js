import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal, effect as _effect } from "@preact/signals";
class NestedFragmentsElement extends HTMLElement {
  static observedAttributes = ["t1", "t2"];
  set t1(val) {
    this._propsSignals["t1"].value = val;
  }
  set t2(val) {
    this._propsSignals["t2"].value = val;
  }
  get t1() {
    return this._propsSignals["t1"].value;
  }
  get t2() {
    return this._propsSignals["t2"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      t1: _signal(null),
      t2: _signal(null)
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
      const show = _signal(true);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _renderDynamic(el0, () => show.value && (() => {
          const frag0 = document.createDocumentFragment();
          const el1 = document.createElement("span");
          _effect(() => el1.title = props.t1);
          const text2 = document.createTextNode("Part 1");
          el1.appendChild(text2);
          frag0.appendChild(el1);
          const el3 = document.createElement("span");
          _effect(() => el3.title = props.t2);
          const text4 = document.createTextNode("Part 2");
          el3.appendChild(text4);
          frag0.appendChild(el3);
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